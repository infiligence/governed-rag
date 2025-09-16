/**
 * Gateway API for Governed RAG System
 * 
 * This is the main API gateway that orchestrates all services and provides
 * the primary interface for the governed RAG system.
 */

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import axios from 'axios';
import { GovernedRetriever } from './retriever';
import { synthesizeResponse } from './synthesis';
import { redactionService } from './redactor';
import { z } from 'zod';

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'dev_only_change_me';
const POSTGRES_URL = process.env.POSTGRES_URL || 'postgres://postgres:postgres@postgres:5432/govrag';
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const PDP_URL = process.env.PDP_URL || 'http://pdp:3001';
const TENANT = process.env.TENANT || 'dash';

// Database connection
const db = new Pool({
  connectionString: POSTGRES_URL
});

// Input validation schemas
const SearchRequestSchema = z.object({
  query: z.string().min(1),
  top_k: z.number().min(1).max(50).default(10),
  user_id: z.string()
});

const StepUpRequestSchema = z.object({
  user_id: z.string(),
  mfa_token: z.string().optional()
});

const ExportRequestSchema = z.object({
  query: z.string().min(1),
  user_id: z.string(),
  format: z.enum(['json', 'csv', 'pdf']).default('json')
});

// Mock Redis for session storage (in production, use actual Redis)
const sessionStore = new Map<string, any>();

/**
 * Authentication middleware
 */
function authenticateToken(req: any, res: any, next: any) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
}

/**
 * Audit logging middleware
 */
async function auditLog(req: any, res: any, next: any) {
  const originalSend = res.send;
  
  res.send = function(data: any) {
    // Log the request after response is sent
    setImmediate(async () => {
      try {
        await logAuditEvent(req, res, data);
      } catch (error) {
        console.error('Audit logging failed:', error);
      }
    });
    
    return originalSend.call(this, data);
  };
  
  next();
}

/**
 * Log audit event
 */
async function logAuditEvent(req: any, res: any, responseData: any) {
  const userId = req.user?.user_id || req.body?.user_id || 'anonymous';
  const action = req.method + ' ' + req.path;
  const objectId = req.params?.id || req.body?.doc_id || null;
  
  let policyDecision = 'ALLOW';
  if (res.statusCode >= 400) {
    policyDecision = 'DENY';
  }
  
  const auditQuery = `
    INSERT INTO audit_events (actor_user_id, action, object_id, object_type, policy_decision, reason, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `;
  
  await db.query(auditQuery, [
    userId,
    action,
    objectId,
    'api_request',
    policyDecision,
    `HTTP ${res.statusCode}`,
    JSON.stringify({
      method: req.method,
      path: req.path,
      user_agent: req.get('User-Agent'),
      ip: req.ip,
      response_status: res.statusCode
    })
  ]);
}

/**
 * Get user from database
 */
async function getUser(userId: string) {
  const query = `
    SELECT user_id, email, groups, mfa_level, attributes
    FROM identities
    WHERE user_id = $1
  `;
  
  const result = await db.query(query, [userId]);
  return result.rows[0];
}

/**
 * Search endpoint
 */
app.post('/search', authenticateToken, auditLog, async (req, res) => {
  try {
    // Validate input
    const validatedInput = SearchRequestSchema.parse(req.body);
    const { query, top_k, user_id } = validatedInput;
    
    // Get user information
    const user = await getUser(user_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check session for MFA status
    const sessionKey = `mfa:${user_id}`;
    const mfaSatisfied = sessionStore.get(sessionKey) || false;
    
    // Create user object for retriever
    const userObj = {
      user_id: user.user_id,
      groups: user.groups,
      attrs: {
        ...user.attributes,
        mfa_satisfied: mfaSatisfied
      },
      tenant: TENANT
    };
    
    // Initialize retriever
    const retriever = new GovernedRetriever({ connectionString: POSTGRES_URL }, PDP_URL);
    
    try {
      // Retrieve chunks with policy enforcement
      const retrievalResult = await retriever.retrieve({
        user: userObj,
        query,
        top_k,
        min_evidence_threshold: 2
      });
      
      // Check for insufficient evidence
      if (retrievalResult.insufficient_evidence) {
        const watermarkedResponse = {
          response: "Insufficient governed evidence to provide a reliable answer.",
          sources: [],
          confidence: 0,
          policy_decisions: retrievalResult.policy_decisions,
          redaction_applied: false,
          insufficient_evidence: true
        };
        
        return res.json(watermarkedResponse);
      }
      
      // Apply redaction based on classification
      const redactedChunks = retrievalResult.chunks.map(chunk => {
        const redactionResult = redactionService.maskPII(chunk.text, chunk.label);
        return {
          ...chunk,
          text: redactionResult.text,
          redaction_applied: redactionResult.redaction_applied
        };
      });
      
      // Synthesize response
      const synthesisResult = synthesizeResponse(redactedChunks, query, 1000);
      
      // Prepare response
      const response = {
        response: synthesisResult.response,
        sources: synthesisResult.sources,
        confidence: synthesisResult.confidence,
        policy_decisions: retrievalResult.policy_decisions,
        redaction_applied: redactedChunks.some(c => c.redaction_applied),
        insufficient_evidence: synthesisResult.insufficient_evidence,
        evidence_count: retrievalResult.evidence_count
      };
      
      res.json(response);
      
    } finally {
      await retriever.close();
    }
    
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      error: 'Search failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Step-up authentication endpoint
 */
app.post('/auth/step-up', authenticateToken, auditLog, async (req, res) => {
  try {
    const validatedInput = StepUpRequestSchema.parse(req.body);
    const { user_id, mfa_token } = validatedInput;
    
    // In a real system, validate MFA token
    // For demo, just simulate success
    const sessionKey = `mfa:${user_id}`;
    sessionStore.set(sessionKey, true);
    
    // Set expiration (5 minutes)
    setTimeout(() => {
      sessionStore.delete(sessionKey);
    }, 5 * 60 * 1000);
    
    res.json({
      success: true,
      message: 'MFA step-up completed',
      expires_in: 300
    });
    
  } catch (error) {
    console.error('Step-up error:', error);
    res.status(500).json({
      error: 'Step-up failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Export endpoint (with policy enforcement)
 */
app.post('/export', authenticateToken, auditLog, async (req, res) => {
  try {
    const validatedInput = ExportRequestSchema.parse(req.body);
    const { query, user_id, format } = validatedInput;
    
    // Get user information
    const user = await getUser(user_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user has export permissions
    if (!user.attributes.allow_export) {
      // Log denied export attempt
      await db.query(`
        INSERT INTO audit_events (actor_user_id, action, object_type, policy_decision, reason)
        VALUES ($1, $2, $3, $4, $5)
      `, [user_id, 'EXPORT_DENIED', 'export_request', 'DENY', 'User lacks export permissions']);
      
      return res.status(403).json({
        error: 'Export denied',
        reason: 'User lacks export permissions',
        policy_decision: 'DENY'
      });
    }
    
    // For demo, just return a message
    res.json({
      message: 'Export functionality would be implemented here',
      query,
      format,
      user_id,
      policy_decision: 'ALLOW'
    });
    
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      error: 'Export failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Audit trail endpoint
 */
app.get('/audit/:user_id', authenticateToken, auditLog, async (req, res) => {
  try {
    const { user_id } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;
    
    const query = `
      SELECT 
        event_id,
        ts,
        action,
        object_id,
        object_type,
        policy_decision,
        reason,
        hash,
        prev_hash,
        metadata
      FROM audit_events
      WHERE actor_user_id = $1
      ORDER BY ts DESC
      LIMIT $2
    `;
    
    const result = await db.query(query, [user_id, limit]);
    
    res.json({
      user_id,
      events: result.rows,
      count: result.rows.length
    });
    
  } catch (error) {
    console.error('Audit error:', error);
    res.status(500).json({
      error: 'Audit retrieval failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await db.query('SELECT 1');
    
    // Check PDP service
    const pdpResponse = await axios.get(`${PDP_URL}/health`, { timeout: 2000 });
    
    res.json({
      status: 'healthy',
      service: 'gateway-api',
      database: 'connected',
      pdp: pdpResponse.data.status === 'healthy' ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'gateway-api',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Generate JWT token for demo
 */
app.post('/auth/token', async (req, res) => {
  try {
    const { user_id } = req.body;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id required' });
    }
    
    const user = await getUser(user_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const token = jwt.sign(
      {
        user_id: user.user_id,
        email: user.email,
        groups: user.groups,
        attrs: user.attributes,
        tenant: TENANT
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    res.json({
      token,
      user_id: user.user_id,
      expires_in: 3600
    });
    
  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({
      error: 'Token generation failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Gateway API running on port ${PORT}`);
  console.log(`Database: ${POSTGRES_URL}`);
  console.log(`PDP URL: ${PDP_URL}`);
  console.log(`Tenant: ${TENANT}`);
});

export default app;

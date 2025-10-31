/**
 * Explain Service - Provides explainability for RAG decisions
 * 
 * This service tracks and explains:
 * - Why certain chunks were retrieved
 * - Which policies allowed/denied access
 * - What redactions were applied
 * - The reasoning chain from query to response
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Pool } from 'pg';
import axios from 'axios';
import { z } from 'zod';

const fastify = Fastify({ logger: true });

// Configuration
const POSTGRES_URL = process.env.POSTGRES_URL || 'postgres://postgres:postgres@postgres:5432/govrag';
const PDP_URL = process.env.PDP_URL || 'http://pdp:3001';
const PORT = parseInt(process.env.PORT || '3003');

// Database connection
const db = new Pool({ connectionString: POSTGRES_URL });

// Input schemas
const ExplainDecisionSchema = z.object({
  user_id: z.string(),
  chunk_id: z.string(),
  decision: z.enum(['ALLOW', 'DENY', 'STEP_UP_REQUIRED']),
  context: z.record(z.any()).optional()
});

const ExplainRetrievalSchema = z.object({
  query: z.string(),
  user_id: z.string(),
  chunks: z.array(z.object({
    chunk_id: z.string(),
    similarity: z.number(),
    label: z.string(),
    decision: z.string()
  }))
});

interface ExplainDecisionRequest {
  user_id: string;
  chunk_id: string;
  decision: 'ALLOW' | 'DENY' | 'STEP_UP_REQUIRED';
  context?: Record<string, any>;
}

interface ExplainRetrievalRequest {
  query: string;
  user_id: string;
  chunks: Array<{
    chunk_id: string;
    similarity: number;
    label: string;
    decision: string;
  }>;
}

/**
 * Get user information
 */
async function getUser(userId: string) {
  const query = `
    SELECT user_id, email, groups, attributes
    FROM identities
    WHERE user_id = $1
  `;
  const result = await db.query(query, [userId]);
  return result.rows[0];
}

/**
 * Get chunk information
 */
async function getChunk(chunkId: string) {
  const query = `
    SELECT c.chunk_id, c.doc_id, c.text, c.label, d.source, d.owner_user_id, d.tenant
    FROM chunks c
    JOIN documents d ON c.doc_id = d.doc_id
    WHERE c.chunk_id = $1
  `;
  const result = await db.query(query, [chunkId]);
  return result.rows[0];
}

/**
 * Explain policy decision
 */
fastify.post<{ Body: ExplainDecisionRequest }>('/explain/decision', async (request, reply) => {
  try {
    const validated = ExplainDecisionSchema.parse(request.body);
    const { user_id, chunk_id, decision, context } = validated;

    // Get user and chunk information
    const [user, chunk] = await Promise.all([
      getUser(user_id),
      getChunk(chunk_id)
    ]);

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    if (!chunk) {
      return reply.code(404).send({ error: 'Chunk not found' });
    }

    // Query PDP for explanation
    let policyExplanation = null;
    try {
      const pdpResponse = await axios.post(`${PDP_URL}/explain`, {
        subject: {
          user_id: user.user_id,
          groups: user.groups,
          attrs: user.attributes
        },
        resource: {
          label: chunk.label,
          source: chunk.source,
          owner: chunk.owner_user_id,
          tenant: chunk.tenant
        },
        action: 'read',
        decision
      }, { timeout: 5000 });

      policyExplanation = pdpResponse.data;
    } catch (error) {
      fastify.log.warn('PDP explanation failed:', error);
    }

    // Build explanation
    const explanation = {
      decision,
      user: {
        user_id: user.user_id,
        groups: user.groups,
        clearance: user.attributes.clearance,
        mfa_satisfied: user.attributes.mfa_satisfied
      },
      resource: {
        chunk_id: chunk.chunk_id,
        label: chunk.label,
        source: chunk.source,
        owner: chunk.owner_user_id
      },
      policy: policyExplanation,
      reasoning: buildReasoning(decision, user, chunk, policyExplanation),
      recommendations: buildRecommendations(decision, user, chunk)
    };

    return explanation;

  } catch (error) {
    fastify.log.error('Explain decision error:', error);
    return reply.code(500).send({
      error: 'Failed to explain decision',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Explain retrieval results
 */
fastify.post<{ Body: ExplainRetrievalRequest }>('/explain/retrieval', async (request, reply) => {
  try {
    const validated = ExplainRetrievalSchema.parse(request.body);
    const { query, user_id, chunks } = validated;

    const user = await getUser(user_id);
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    // Analyze retrieval results
    const allowedChunks = chunks.filter(c => c.decision === 'ALLOW');
    const deniedChunks = chunks.filter(c => c.decision === 'DENY');
    const stepUpChunks = chunks.filter(c => c.decision === 'STEP_UP_REQUIRED');

    // Count by label
    const labelCounts: Record<string, { allowed: number; denied: number; step_up: number }> = {};
    
    chunks.forEach(chunk => {
      if (!labelCounts[chunk.label]) {
        labelCounts[chunk.label] = { allowed: 0, denied: 0, step_up: 0 };
      }
      
      if (chunk.decision === 'ALLOW') labelCounts[chunk.label].allowed++;
      else if (chunk.decision === 'DENY') labelCounts[chunk.label].denied++;
      else if (chunk.decision === 'STEP_UP_REQUIRED') labelCounts[chunk.label].step_up++;
    });

    // Build explanation
    const explanation = {
      query,
      user: {
        user_id: user.user_id,
        groups: user.groups,
        clearance: user.attributes.clearance
      },
      summary: {
        total_chunks: chunks.length,
        allowed: allowedChunks.length,
        denied: deniedChunks.length,
        step_up_required: stepUpChunks.length,
        coverage: allowedChunks.length / chunks.length
      },
      by_label: labelCounts,
      reasoning: buildRetrievalReasoning(user, chunks, labelCounts),
      recommendations: buildRetrievalRecommendations(user, deniedChunks, stepUpChunks)
    };

    return explanation;

  } catch (error) {
    fastify.log.error('Explain retrieval error:', error);
    return reply.code(500).send({
      error: 'Failed to explain retrieval',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get audit trail with explanations
 */
fastify.get<{ Params: { userId: string } }>('/explain/audit/:userId', async (request, reply) => {
  try {
    const { userId } = request.params;
    const limit = parseInt((request.query as any).limit || '50');

    const query = `
      SELECT 
        event_id,
        ts,
        action,
        object_id,
        object_type,
        policy_decision,
        reason,
        metadata
      FROM audit_events
      WHERE actor_user_id = $1
      ORDER BY ts DESC
      LIMIT $2
    `;

    const result = await db.query(query, [userId, limit]);

    const eventsWithExplanations = result.rows.map(event => ({
      event_id: event.event_id,
      timestamp: event.ts,
      action: event.action,
      decision: event.policy_decision,
      reason: event.reason,
      metadata: event.metadata,
      explanation: explainAuditEvent(event)
    }));

    return {
      user_id: userId,
      events: eventsWithExplanations,
      count: eventsWithExplanations.length
    };

  } catch (error) {
    fastify.log.error('Audit explanation error:', error);
    return reply.code(500).send({
      error: 'Failed to explain audit trail',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Health check
 */
fastify.get('/health', async (request, reply) => {
  try {
    await db.query('SELECT 1');
    return { status: 'healthy', service: 'explain' };
  } catch (error) {
    return reply.code(503).send({ 
      status: 'unhealthy', 
      service: 'explain',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Helper functions

function buildReasoning(
  decision: string,
  user: any,
  chunk: any,
  policyExplanation: any
): string[] {
  const reasoning: string[] = [];

  if (decision === 'ALLOW') {
    reasoning.push(`Access granted to ${chunk.label} document`);
    
    if (chunk.label === 'Public') {
      reasoning.push('Public documents are accessible to all authenticated users');
    } else if (user.groups.includes('eng') && chunk.label === 'Internal') {
      reasoning.push('User is member of engineering group with access to Internal documents');
    } else if (user.attributes.clearance === chunk.label.toLowerCase()) {
      reasoning.push(`User has ${chunk.label.toLowerCase()} clearance level`);
    }

    if (policyExplanation?.rules_applied) {
      reasoning.push(`Applied policies: ${policyExplanation.rules_applied.join(', ')}`);
    }
  } else if (decision === 'DENY') {
    reasoning.push(`Access denied to ${chunk.label} document`);
    
    if (user.attributes.clearance !== chunk.label.toLowerCase()) {
      reasoning.push(`User clearance (${user.attributes.clearance}) insufficient for ${chunk.label} content`);
    }
    
    if (!user.groups.includes('eng') && chunk.label === 'Internal') {
      reasoning.push('User not member of required groups for Internal documents');
    }
  } else if (decision === 'STEP_UP_REQUIRED') {
    reasoning.push('Multi-factor authentication required for sensitive content');
    reasoning.push(`User has not completed MFA for this session`);
  }

  return reasoning;
}

function buildRecommendations(decision: string, user: any, chunk: any): string[] {
  const recommendations: string[] = [];

  if (decision === 'DENY') {
    if (user.attributes.clearance !== chunk.label.toLowerCase()) {
      recommendations.push('Request clearance upgrade from security team');
    }
    
    if (!user.groups.includes('eng')) {
      recommendations.push('Contact administrator to be added to required groups');
    }
    
    recommendations.push('Contact document owner for alternative access methods');
  } else if (decision === 'STEP_UP_REQUIRED') {
    recommendations.push('Complete multi-factor authentication to access this content');
    recommendations.push('Use /auth/step-up endpoint to complete MFA');
  }

  return recommendations;
}

function buildRetrievalReasoning(
  user: any,
  chunks: any[],
  labelCounts: Record<string, any>
): string[] {
  const reasoning: string[] = [];

  reasoning.push(`Query processed with user clearance: ${user.attributes.clearance}`);
  reasoning.push(`User groups: ${user.groups.join(', ')}`);

  Object.entries(labelCounts).forEach(([label, counts]) => {
    const total = counts.allowed + counts.denied + counts.step_up;
    reasoning.push(
      `${label} documents: ${counts.allowed}/${total} accessible, ${counts.denied} denied, ${counts.step_up} require MFA`
    );
  });

  const allowedCount = chunks.filter(c => c.decision === 'ALLOW').length;
  if (allowedCount === 0) {
    reasoning.push('No accessible chunks found - consider requesting higher clearance');
  } else if (allowedCount < chunks.length * 0.3) {
    reasoning.push('Limited access - many chunks filtered by policy');
  }

  return reasoning;
}

function buildRetrievalRecommendations(user: any, deniedChunks: any[], stepUpChunks: any[]): string[] {
  const recommendations: string[] = [];

  if (stepUpChunks.length > 0) {
    recommendations.push('Complete MFA to access additional sensitive content');
  }

  if (deniedChunks.length > 0) {
    const deniedLabels = [...new Set(deniedChunks.map(c => c.label))];
    recommendations.push(`Request access to: ${deniedLabels.join(', ')} clearance levels`);
  }

  if (deniedChunks.length > stepUpChunks.length * 2) {
    recommendations.push('Consider refining query to focus on accessible content');
  }

  return recommendations;
}

function explainAuditEvent(event: any): string {
  const action = event.action;
  const decision = event.policy_decision;

  if (action.startsWith('POST /search')) {
    return `Search query ${decision === 'ALLOW' ? 'executed' : 'blocked'} by policy`;
  } else if (action.startsWith('POST /export')) {
    return `Export ${decision === 'ALLOW' ? 'permitted' : 'denied'} based on user permissions`;
  } else if (action.startsWith('POST /auth/step-up')) {
    return 'Multi-factor authentication completed';
  }

  return `Action ${action} resulted in ${decision}`;
}

// Start server
const start = async () => {
  try {
    await fastify.register(cors, { origin: true });
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Explain service running on port ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();


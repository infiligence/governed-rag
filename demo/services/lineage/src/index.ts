/**
 * Lineage Service - Hash-chained audit ledger
 * 
 * This service provides:
 * - Tamper-evident event logging
 * - Hash-chained audit trail
 * - Data lineage tracking from source to response
 * - Integrity verification
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Pool } from 'pg';
import { createHash } from 'crypto';
import { z } from 'zod';

const fastify = Fastify({ logger: true });

// Configuration
const POSTGRES_URL = process.env.POSTGRES_URL || 'postgres://postgres:postgres@postgres:5432/govrag';
const PORT = parseInt(process.env.PORT || '3004');

// Database connection
const db = new Pool({ connectionString: POSTGRES_URL });

// Event schemas
const LineageEventSchema = z.object({
  actor_user_id: z.string(),
  action: z.string(),
  object_id: z.string().optional(),
  object_type: z.string(),
  policy_decision: z.enum(['ALLOW', 'DENY', 'STEP_UP_REQUIRED']),
  reason: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  lineage_chain: z.array(z.object({
    stage: z.string(),
    timestamp: z.string(),
    component: z.string(),
    details: z.record(z.any()).optional()
  })).optional()
});

interface LineageEvent {
  actor_user_id: string;
  action: string;
  object_id?: string;
  object_type: string;
  policy_decision: 'ALLOW' | 'DENY' | 'STEP_UP_REQUIRED';
  reason?: string;
  metadata?: Record<string, any>;
  lineage_chain?: Array<{
    stage: string;
    timestamp: string;
    component: string;
    details?: Record<string, any>;
  }>;
}

interface LineageChain {
  request_id: string;
  query: string;
  user_id: string;
  stages: Array<{
    stage: string;
    timestamp: Date;
    component: string;
    input?: any;
    output?: any;
    policy_decision?: string;
    transformations?: string[];
  }>;
}

/**
 * Record lineage event with hash chaining
 */
fastify.post<{ Body: LineageEvent }>('/lineage/event', async (request, reply) => {
  try {
    const validated = LineageEventSchema.parse(request.body);

    const {
      actor_user_id,
      action,
      object_id,
      object_type,
      policy_decision,
      reason,
      metadata
    } = validated;

    // Get previous hash for this user
    const prevHashQuery = `
      SELECT hash 
      FROM audit_events 
      WHERE actor_user_id = $1 
      ORDER BY ts DESC 
      LIMIT 1
    `;
    const prevHashResult = await db.query(prevHashQuery, [actor_user_id]);
    const prevHash = prevHashResult.rows[0]?.hash || null;

    // Create event record
    const event_id = generateUUID();
    const ts = new Date();

    // Calculate hash
    const hash = calculateHash({
      event_id,
      ts,
      actor_user_id,
      action,
      object_id,
      object_type,
      policy_decision,
      reason,
      prev_hash: prevHash,
      metadata
    });

    // Insert event (trigger will also calculate hash, but we provide it for consistency)
    const insertQuery = `
      INSERT INTO audit_events (
        event_id, ts, actor_user_id, action, object_id, object_type,
        policy_decision, reason, hash, prev_hash, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING event_id, hash
    `;

    const result = await db.query(insertQuery, [
      event_id,
      ts,
      actor_user_id,
      action,
      object_id || null,
      object_type,
      policy_decision,
      reason || null,
      hash,
      prevHash,
      JSON.stringify(metadata || {})
    ]);

    return {
      event_id: result.rows[0].event_id,
      hash: result.rows[0].hash,
      prev_hash: prevHash,
      timestamp: ts,
      message: 'Event recorded in hash-chained ledger'
    };

  } catch (error) {
    fastify.log.error('Lineage event error:', error);
    return reply.code(500).send({
      error: 'Failed to record lineage event',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get lineage chain for a user
 */
fastify.get<{ Params: { userId: string } }>('/lineage/user/:userId', async (request, reply) => {
  try {
    const { userId } = request.params;
    const limit = parseInt((request.query as any).limit || '100');

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

    const result = await db.query(query, [userId, limit]);

    // Verify chain integrity
    const chainIntegrity = verifyChainIntegrity(result.rows);

    return {
      user_id: userId,
      events: result.rows,
      count: result.rows.length,
      chain_integrity: chainIntegrity
    };

  } catch (error) {
    fastify.log.error('Get lineage error:', error);
    return reply.code(500).send({
      error: 'Failed to retrieve lineage',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get complete lineage for a query/request
 */
fastify.get<{ Params: { requestId: string } }>('/lineage/request/:requestId', async (request, reply) => {
  try {
    const { requestId } = request.params;

    const query = `
      SELECT 
        event_id,
        ts,
        actor_user_id,
        action,
        object_id,
        object_type,
        policy_decision,
        reason,
        metadata
      FROM audit_events
      WHERE metadata->>'request_id' = $1
      ORDER BY ts ASC
    `;

    const result = await db.query(query, [requestId]);

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Request not found' });
    }

    // Build lineage chain
    const lineageChain = buildLineageChain(result.rows);

    return lineageChain;

  } catch (error) {
    fastify.log.error('Get request lineage error:', error);
    return reply.code(500).send({
      error: 'Failed to retrieve request lineage',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Verify hash chain integrity
 */
fastify.post<{ Body: { user_id: string; start_date?: string; end_date?: string } }>(
  '/lineage/verify',
  async (request, reply) => {
    try {
      const { user_id, start_date, end_date } = request.body;

      let query = `
        SELECT 
          event_id,
          ts,
          actor_user_id,
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
      `;

      const params: any[] = [user_id];

      if (start_date) {
        params.push(start_date);
        query += ` AND ts >= $${params.length}`;
      }

      if (end_date) {
        params.push(end_date);
        query += ` AND ts <= $${params.length}`;
      }

      query += ` ORDER BY ts ASC`;

      const result = await db.query(query, params);

      if (result.rows.length === 0) {
        return { valid: true, message: 'No events found' };
      }

      // Verify each event's hash
      const verification = verifyDetailedChainIntegrity(result.rows);

      return verification;

    } catch (error) {
      fastify.log.error('Verify chain error:', error);
      return reply.code(500).send({
        error: 'Failed to verify chain',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * Get lineage statistics
 */
fastify.get('/lineage/stats', async (request, reply) => {
  try {
    const statsQuery = `
      SELECT 
        COUNT(*) as total_events,
        COUNT(DISTINCT actor_user_id) as unique_users,
        COUNT(DISTINCT object_type) as unique_object_types,
        COUNT(CASE WHEN policy_decision = 'ALLOW' THEN 1 END) as allowed_events,
        COUNT(CASE WHEN policy_decision = 'DENY' THEN 1 END) as denied_events,
        MIN(ts) as earliest_event,
        MAX(ts) as latest_event
      FROM audit_events
    `;

    const result = await db.query(statsQuery);

    return {
      statistics: result.rows[0],
      chain_type: 'hash-chained ledger',
      immutable: true
    };

  } catch (error) {
    fastify.log.error('Get stats error:', error);
    return reply.code(500).send({
      error: 'Failed to retrieve statistics',
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
    return { status: 'healthy', service: 'lineage' };
  } catch (error) {
    return reply.code(503).send({
      status: 'unhealthy',
      service: 'lineage',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Helper functions

function calculateHash(event: any): string {
  const hashInput = [
    event.event_id,
    event.ts.toISOString(),
    event.actor_user_id,
    event.action,
    event.object_id || '',
    event.object_type,
    event.policy_decision,
    event.reason || '',
    event.prev_hash || '',
    JSON.stringify(event.metadata || {})
  ].join('|');

  return createHash('sha256').update(hashInput).digest('hex');
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function verifyChainIntegrity(events: any[]): {
  valid: boolean;
  broken_links: number;
  total_links: number;
} {
  if (events.length === 0) {
    return { valid: true, broken_links: 0, total_links: 0 };
  }

  let brokenLinks = 0;
  const totalLinks = events.length - 1;

  // Reverse to check from oldest to newest
  const reversedEvents = [...events].reverse();

  for (let i = 1; i < reversedEvents.length; i++) {
    const currentEvent = reversedEvents[i];
    const previousEvent = reversedEvents[i - 1];

    if (currentEvent.prev_hash !== previousEvent.hash) {
      brokenLinks++;
    }
  }

  return {
    valid: brokenLinks === 0,
    broken_links: brokenLinks,
    total_links: totalLinks
  };
}

function verifyDetailedChainIntegrity(events: any[]): {
  valid: boolean;
  total_events: number;
  verified_events: number;
  failed_events: any[];
  broken_links: any[];
} {
  const failedEvents: any[] = [];
  const brokenLinks: any[] = [];
  let verifiedEvents = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Recalculate hash
    const calculatedHash = calculateHash({
      event_id: event.event_id,
      ts: new Date(event.ts),
      actor_user_id: event.actor_user_id,
      action: event.action,
      object_id: event.object_id,
      object_type: event.object_type,
      policy_decision: event.policy_decision,
      reason: event.reason,
      prev_hash: event.prev_hash,
      metadata: event.metadata
    });

    if (calculatedHash !== event.hash) {
      failedEvents.push({
        event_id: event.event_id,
        timestamp: event.ts,
        expected_hash: event.hash,
        calculated_hash: calculatedHash
      });
    } else {
      verifiedEvents++;
    }

    // Check link to previous event
    if (i > 0) {
      const previousEvent = events[i - 1];
      if (event.prev_hash !== previousEvent.hash) {
        brokenLinks.push({
          event_id: event.event_id,
          timestamp: event.ts,
          expected_prev_hash: event.prev_hash,
          actual_prev_hash: previousEvent.hash
        });
      }
    }
  }

  return {
    valid: failedEvents.length === 0 && brokenLinks.length === 0,
    total_events: events.length,
    verified_events: verifiedEvents,
    failed_events: failedEvents,
    broken_links: brokenLinks
  };
}

function buildLineageChain(events: any[]): LineageChain {
  const firstEvent = events[0];
  const metadata = firstEvent.metadata || {};

  const stages = events.map(event => ({
    stage: event.action,
    timestamp: event.ts,
    component: event.object_type,
    policy_decision: event.policy_decision,
    reason: event.reason,
    metadata: event.metadata
  }));

  return {
    request_id: metadata.request_id || 'unknown',
    query: metadata.query || '',
    user_id: firstEvent.actor_user_id,
    stages
  };
}

// Start server
const start = async () => {
  try {
    await fastify.register(cors, { origin: true });
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Lineage service running on port ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();


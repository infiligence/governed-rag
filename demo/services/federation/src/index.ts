/**
 * Federation Service - Multi-source governed retrieval
 * 
 * This service enables querying across multiple governed data sources
 * while maintaining policy enforcement and auditability for each source.
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
const PORT = parseInt(process.env.PORT || '3005');

// Database connection
const db = new Pool({ connectionString: POSTGRES_URL });

// Schemas
const FederatedQuerySchema = z.object({
  query: z.string(),
  user_id: z.string(),
  sources: z.array(z.string()).optional(),
  top_k: z.number().min(1).max(100).default(10),
  min_similarity: z.number().min(0).max(1).default(0.5)
});

const RegisterSourceSchema = z.object({
  source_id: z.string(),
  source_type: z.enum(['local', 'remote_api', 'database', 's3']),
  config: z.object({
    url: z.string().optional(),
    api_key: z.string().optional(),
    database_url: z.string().optional(),
    bucket: z.string().optional()
  }),
  policy_override: z.record(z.any()).optional()
});

interface FederatedQuery {
  query: string;
  user_id: string;
  sources?: string[];
  top_k: number;
  min_similarity: number;
}

interface DataSource {
  source_id: string;
  source_type: string;
  config: Record<string, any>;
  enabled: boolean;
  policy_override?: Record<string, any>;
}

// In-memory source registry (in production, use database)
const sourceRegistry = new Map<string, DataSource>();

/**
 * Register a new data source
 */
fastify.post('/federation/sources/register', async (request, reply) => {
  try {
    const validated = RegisterSourceSchema.parse(request.body);
    
    const source: DataSource = {
      source_id: validated.source_id,
      source_type: validated.source_type,
      config: validated.config,
      enabled: true,
      policy_override: validated.policy_override
    };

    sourceRegistry.set(source.source_id, source);

    fastify.log.info(`Registered source: ${source.source_id}`);

    return {
      source_id: source.source_id,
      message: 'Source registered successfully',
      enabled: source.enabled
    };

  } catch (error) {
    fastify.log.error('Register source error:', error);
    return reply.code(500).send({
      error: 'Failed to register source',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * List registered sources
 */
fastify.get('/federation/sources', async (request, reply) => {
  try {
    const sources = Array.from(sourceRegistry.values()).map(source => ({
      source_id: source.source_id,
      source_type: source.source_type,
      enabled: source.enabled,
      has_policy_override: !!source.policy_override
    }));

    return {
      sources,
      count: sources.length
    };

  } catch (error) {
    fastify.log.error('List sources error:', error);
    return reply.code(500).send({
      error: 'Failed to list sources',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Execute federated query across multiple sources
 */
fastify.post<{ Body: FederatedQuery }>('/federation/query', async (request, reply) => {
  try {
    const validated = FederatedQuerySchema.parse(request.body);
    const { query, user_id, sources, top_k, min_similarity } = validated;

    // Get user information
    const user = await getUser(user_id);
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    // Determine which sources to query
    const targetSources = sources && sources.length > 0
      ? sources.filter(s => sourceRegistry.has(s))
      : Array.from(sourceRegistry.keys());

    if (targetSources.length === 0) {
      return reply.code(400).send({ error: 'No valid sources specified' });
    }

    // Query each source in parallel
    const sourceResults = await Promise.allSettled(
      targetSources.map(sourceId =>
        querySource(sourceId, query, user, top_k, min_similarity)
      )
    );

    // Aggregate results
    const allChunks: any[] = [];
    const sourceStatus: Record<string, any> = {};

    sourceResults.forEach((result, index) => {
      const sourceId = targetSources[index];
      
      if (result.status === 'fulfilled') {
        sourceStatus[sourceId] = {
          status: 'success',
          chunks_count: result.value.chunks.length
        };
        allChunks.push(...result.value.chunks.map((c: any) => ({
          ...c,
          federation_source: sourceId
        })));
      } else {
        sourceStatus[sourceId] = {
          status: 'failed',
          error: result.reason?.message || 'Unknown error'
        };
      }
    });

    // Sort by similarity and apply top_k
    allChunks.sort((a, b) => b.similarity - a.similarity);
    const topChunks = allChunks.slice(0, top_k);

    // Apply policy filtering
    const filteredChunks: any[] = [];
    const policyDecisions: any[] = [];

    for (const chunk of topChunks) {
      const decision = await evaluatePolicy(user, chunk);
      policyDecisions.push(decision);

      if (decision.allow) {
        filteredChunks.push(chunk);
      }
    }

    return {
      query,
      user_id,
      sources_queried: targetSources,
      source_status: sourceStatus,
      total_chunks: allChunks.length,
      allowed_chunks: filteredChunks.length,
      chunks: filteredChunks,
      policy_decisions: policyDecisions
    };

  } catch (error) {
    fastify.log.error('Federated query error:', error);
    return reply.code(500).send({
      error: 'Federated query failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Query individual source status
 */
fastify.get<{ Params: { sourceId: string } }>('/federation/sources/:sourceId/status', async (request, reply) => {
  try {
    const { sourceId } = request.params;

    const source = sourceRegistry.get(sourceId);
    if (!source) {
      return reply.code(404).send({ error: 'Source not found' });
    }

    // Test connectivity
    const isHealthy = await testSourceConnectivity(source);

    // Get statistics
    const stats = await getSourceStatistics(sourceId);

    return {
      source_id: sourceId,
      source_type: source.source_type,
      enabled: source.enabled,
      healthy: isHealthy,
      statistics: stats
    };

  } catch (error) {
    fastify.log.error('Source status error:', error);
    return reply.code(500).send({
      error: 'Failed to get source status',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Disable a source
 */
fastify.post<{ Params: { sourceId: string } }>('/federation/sources/:sourceId/disable', async (request, reply) => {
  try {
    const { sourceId } = request.params;

    const source = sourceRegistry.get(sourceId);
    if (!source) {
      return reply.code(404).send({ error: 'Source not found' });
    }

    source.enabled = false;
    sourceRegistry.set(sourceId, source);

    return {
      source_id: sourceId,
      enabled: false,
      message: 'Source disabled'
    };

  } catch (error) {
    fastify.log.error('Disable source error:', error);
    return reply.code(500).send({
      error: 'Failed to disable source',
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
    return { 
      status: 'healthy', 
      service: 'federation',
      registered_sources: sourceRegistry.size
    };
  } catch (error) {
    return reply.code(503).send({
      status: 'unhealthy',
      service: 'federation',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Helper functions

async function getUser(userId: string) {
  const query = `
    SELECT user_id, email, groups, attributes
    FROM identities
    WHERE user_id = $1
  `;
  const result = await db.query(query, [userId]);
  return result.rows[0];
}

async function querySource(
  sourceId: string,
  query: string,
  user: any,
  top_k: number,
  min_similarity: number
): Promise<{ chunks: any[] }> {
  const source = sourceRegistry.get(sourceId);
  
  if (!source || !source.enabled) {
    throw new Error(`Source ${sourceId} not available`);
  }

  switch (source.source_type) {
    case 'local':
      return queryLocalSource(sourceId, query, user, top_k, min_similarity);
    
    case 'remote_api':
      return queryRemoteAPI(source, query, user, top_k);
    
    case 'database':
      return queryDatabase(source, query, user, top_k, min_similarity);
    
    default:
      throw new Error(`Unsupported source type: ${source.source_type}`);
  }
}

async function queryLocalSource(
  sourceId: string,
  query: string,
  user: any,
  top_k: number,
  min_similarity: number
): Promise<{ chunks: any[] }> {
  // Query local database for this specific source
  const dbQuery = `
    SELECT 
      c.chunk_id,
      c.text,
      c.label,
      d.source,
      d.owner_user_id,
      d.tenant,
      0.8 as similarity
    FROM chunks c
    JOIN documents d ON c.doc_id = d.doc_id
    WHERE d.source = $1
      AND d.tenant = $2
    ORDER BY c.created_at DESC
    LIMIT $3
  `;

  const result = await db.query(dbQuery, [sourceId, user.tenant || 'dash', top_k]);

  return {
    chunks: result.rows.map(row => ({
      chunk_id: row.chunk_id,
      text: row.text,
      label: row.label,
      source: row.source,
      owner_user_id: row.owner_user_id,
      similarity: parseFloat(row.similarity)
    }))
  };
}

async function queryRemoteAPI(
  source: DataSource,
  query: string,
  user: any,
  top_k: number
): Promise<{ chunks: any[] }> {
  const response = await axios.post(
    source.config.url!,
    {
      query,
      user_id: user.user_id,
      top_k
    },
    {
      headers: {
        'Authorization': `Bearer ${source.config.api_key || ''}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    }
  );

  return {
    chunks: response.data.chunks || []
  };
}

async function queryDatabase(
  source: DataSource,
  query: string,
  user: any,
  top_k: number,
  min_similarity: number
): Promise<{ chunks: any[] }> {
  // Connect to external database
  const externalDb = new Pool({
    connectionString: source.config.database_url
  });

  try {
    const result = await externalDb.query(`
      SELECT chunk_id, text, label, similarity
      FROM chunks
      WHERE similarity >= $1
      ORDER BY similarity DESC
      LIMIT $2
    `, [min_similarity, top_k]);

    return {
      chunks: result.rows
    };
  } finally {
    await externalDb.end();
  }
}

async function evaluatePolicy(user: any, chunk: any): Promise<any> {
  try {
    const response = await axios.post(`${PDP_URL}/authorize`, {
      subject: {
        user_id: user.user_id,
        groups: user.groups,
        attrs: user.attributes
      },
      resource: {
        label: chunk.label,
        source: chunk.source || chunk.federation_source,
        owner: chunk.owner_user_id,
        tenant: user.tenant || 'dash'
      },
      action: 'read'
    }, { timeout: 5000 });

    return {
      chunk_id: chunk.chunk_id,
      allow: response.data.allow,
      step_up_required: response.data.step_up_required,
      reason: response.data.reason
    };
  } catch (error) {
    fastify.log.error('Policy evaluation error:', error);
    return {
      chunk_id: chunk.chunk_id,
      allow: false,
      reason: 'Policy evaluation failed'
    };
  }
}

async function testSourceConnectivity(source: DataSource): Promise<boolean> {
  try {
    switch (source.source_type) {
      case 'local':
        await db.query('SELECT 1');
        return true;
      
      case 'remote_api':
        if (source.config.url) {
          await axios.get(`${source.config.url}/health`, { timeout: 5000 });
          return true;
        }
        return false;
      
      case 'database':
        if (source.config.database_url) {
          const testDb = new Pool({ connectionString: source.config.database_url });
          await testDb.query('SELECT 1');
          await testDb.end();
          return true;
        }
        return false;
      
      default:
        return false;
    }
  } catch (error) {
    return false;
  }
}

async function getSourceStatistics(sourceId: string): Promise<any> {
  try {
    const query = `
      SELECT 
        COUNT(DISTINCT d.doc_id) as document_count,
        COUNT(c.chunk_id) as chunk_count,
        COUNT(DISTINCT c.label) as unique_labels
      FROM documents d
      LEFT JOIN chunks c ON d.doc_id = c.doc_id
      WHERE d.source = $1
    `;

    const result = await db.query(query, [sourceId]);
    return result.rows[0];
  } catch (error) {
    return {
      document_count: 0,
      chunk_count: 0,
      unique_labels: 0
    };
  }
}

// Initialize default sources
sourceRegistry.set('dropbox', {
  source_id: 'dropbox',
  source_type: 'local',
  config: {},
  enabled: true
});

sourceRegistry.set('jira', {
  source_id: 'jira',
  source_type: 'local',
  config: {},
  enabled: true
});

sourceRegistry.set('confluence', {
  source_id: 'confluence',
  source_type: 'local',
  config: {},
  enabled: true
});

// Start server
const start = async () => {
  try {
    await fastify.register(cors, { origin: true });
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Federation service running on port ${PORT}`);
    console.log(`Registered sources: ${Array.from(sourceRegistry.keys()).join(', ')}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();


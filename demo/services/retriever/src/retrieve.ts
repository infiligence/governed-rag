/**
 * Governed RAG Retriever with Guardrails
 * 
 * This service implements retrieval with policy enforcement, tenant isolation,
 * and evidence threshold validation.
 */

import { Pool } from 'pg';
import axios from 'axios';

export interface User {
  user_id: string;
  groups: string[];
  attrs: Record<string, string>;
  tenant: string;
}

export interface Chunk {
  chunk_id: string;
  doc_id: string;
  text: string;
  label: string;
  similarity: number;
  source: string;
  owner_user_id: string;
}

export interface RetrievalRequest {
  user: User;
  query: string;
  top_k: number;
  min_evidence_threshold: number;
}

export interface RetrievalResponse {
  chunks: Chunk[];
  evidence_count: number;
  policy_decisions: PolicyDecision[];
  redaction_applied: boolean;
  insufficient_evidence: boolean;
}

export interface PolicyDecision {
  chunk_id: string;
  decision: 'ALLOW' | 'DENY' | 'STEP_UP_REQUIRED';
  reason: string;
  policy_id?: string;
}

export class GovernedRetriever {
  private db: Pool;
  private pdpUrl: string;

  constructor(dbConfig: any, pdpUrl: string = 'http://pdp:3001') {
    this.db = new Pool(dbConfig);
    this.pdpUrl = pdpUrl;
  }

  /**
   * Retrieve chunks with policy enforcement
   */
  async retrieve(request: RetrievalRequest): Promise<RetrievalResponse> {
    const { user, query, top_k, min_evidence_threshold } = request;
    
    try {
      // Step 1: Pre-filter by label and tenant (filter-at-index)
      const preFilteredChunks = await this.preFilterChunks(user, query, top_k * 2);
      
      // Step 2: Post-filter with PDP (filter-at-query)
      const policyDecisions: PolicyDecision[] = [];
      const allowedChunks: Chunk[] = [];
      
      for (const chunk of preFilteredChunks) {
        const decision = await this.evaluatePolicy(user, chunk);
        policyDecisions.push(decision);
        
        if (decision.decision === 'ALLOW') {
          allowedChunks.push(chunk);
        }
      }
      
      // Step 3: Apply evidence threshold
      const insufficientEvidence = allowedChunks.length < min_evidence_threshold;
      
      // Step 4: Limit results
      const finalChunks = allowedChunks.slice(0, top_k);
      
      return {
        chunks: finalChunks,
        evidence_count: allowedChunks.length,
        policy_decisions: policyDecisions,
        redaction_applied: false, // Will be applied by gateway
        insufficient_evidence: insufficientEvidence
      };
      
    } catch (error) {
      console.error('Retrieval error:', error);
      throw new Error('Retrieval failed');
    }
  }

  /**
   * Pre-filter chunks by label and tenant
   */
  private async preFilterChunks(user: User, query: string, limit: number): Promise<Chunk[]> {
    const clearanceLevel = user.attrs.clearance || 'public';
    const allowedLabels = this.getAllowedLabels(clearanceLevel);
    
    const queryText = `
      SELECT 
        c.chunk_id,
        c.doc_id,
        c.text,
        c.label,
        d.source,
        d.owner_user_id,
        1 - (c.embedding <=> $1) as similarity
      FROM chunks c
      JOIN documents d ON c.doc_id = d.doc_id
      WHERE c.label = ANY($2)
        AND d.tenant = $3
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $1
      LIMIT $4
    `;
    
    // For demo purposes, use a simple embedding (in production, use actual embedding)
    const queryEmbedding = this.generateSimpleEmbedding(query);
    
    const result = await this.db.query(queryText, [
      queryEmbedding,
      allowedLabels,
      user.tenant,
      limit
    ]);
    
    return result.rows.map(row => ({
      chunk_id: row.chunk_id,
      doc_id: row.doc_id,
      text: row.text,
      label: row.label,
      similarity: parseFloat(row.similarity),
      source: row.source,
      owner_user_id: row.owner_user_id
    }));
  }

  /**
   * Evaluate policy for a chunk
   */
  private async evaluatePolicy(user: User, chunk: Chunk): Promise<PolicyDecision> {
    try {
      const pdpRequest = {
        subject: {
          user_id: user.user_id,
          groups: user.groups,
          attrs: user.attrs
        },
        resource: {
          label: chunk.label,
          source: chunk.source,
          owner: chunk.owner_user_id,
          tenant: user.tenant
        },
        action: 'read'
      };
      
      const response = await axios.post(`${this.pdpUrl}/authorize`, pdpRequest, {
        timeout: 5000
      });
      
      const { allow, step_up_required, reason, policy_id } = response.data;
      
      let decision: 'ALLOW' | 'DENY' | 'STEP_UP_REQUIRED';
      if (step_up_required) {
        decision = 'STEP_UP_REQUIRED';
      } else if (allow) {
        decision = 'ALLOW';
      } else {
        decision = 'DENY';
      }
      
      return {
        chunk_id: chunk.chunk_id,
        decision,
        reason: reason || 'Policy evaluation',
        policy_id
      };
      
    } catch (error) {
      console.error('Policy evaluation error:', error);
      return {
        chunk_id: chunk.chunk_id,
        decision: 'DENY',
        reason: 'Policy evaluation failed'
      };
    }
  }

  /**
   * Get allowed labels based on clearance level
   */
  private getAllowedLabels(clearanceLevel: string): string[] {
    const labelHierarchy = {
      'public': ['Public'],
      'internal': ['Public', 'Internal'],
      'confidential': ['Public', 'Internal', 'Confidential'],
      'regulated': ['Public', 'Internal', 'Confidential', 'Regulated']
    };
    
    return labelHierarchy[clearanceLevel as keyof typeof labelHierarchy] || ['Public'];
  }

  /**
   * Generate simple embedding for demo (in production, use actual embedding model)
   */
  private generateSimpleEmbedding(text: string): string {
    // This is a placeholder - in production, use a proper embedding model
    const words = text.toLowerCase().split(/\s+/);
    const embedding = new Array(768).fill(0);
    
    // Simple word frequency-based embedding
    words.forEach(word => {
      const hash = this.simpleHash(word);
      const index = hash % 768;
      embedding[index] += 1;
    });
    
    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return `[${embedding.map(val => val / norm).join(',')}]`;
  }

  /**
   * Simple hash function for demo
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Get retrieval statistics
   */
  async getRetrievalStats(user: User): Promise<any> {
    const query = `
      SELECT 
        c.label,
        COUNT(*) as chunk_count,
        COUNT(DISTINCT c.doc_id) as document_count
      FROM chunks c
      JOIN documents d ON c.doc_id = d.doc_id
      WHERE d.tenant = $1
      GROUP BY c.label
      ORDER BY c.label
    `;
    
    const result = await this.db.query(query, [user.tenant]);
    return result.rows;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.db.end();
  }
}

// Export utility functions
export async function retrieveChunks(
  dbConfig: any,
  user: User,
  query: string,
  topK: number = 10,
  minEvidenceThreshold: number = 3
): Promise<RetrievalResponse> {
  const retriever = new GovernedRetriever(dbConfig);
  try {
    return await retriever.retrieve({
      user,
      query,
      top_k: topK,
      min_evidence_threshold: minEvidenceThreshold
    });
  } finally {
    await retriever.close();
  }
}

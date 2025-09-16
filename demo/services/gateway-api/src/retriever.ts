/**
 * Simplified Retriever for Gateway API
 */

import { Pool } from 'pg';
import axios from 'axios';

export interface User {
  user_id: string;
  groups: string[];
  attrs: Record<string, any>;
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

  async retrieve(request: RetrievalRequest): Promise<RetrievalResponse> {
    const { user, query, top_k, min_evidence_threshold } = request;
    
    try {
      // Step 1: Pre-filter by label and tenant
      const preFilteredChunks = await this.preFilterChunks(user, query, top_k * 2);
      
      // Step 2: Post-filter with PDP
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
        redaction_applied: false,
        insufficient_evidence: insufficientEvidence
      };
      
    } catch (error) {
      console.error('Retrieval error:', error);
      throw new Error('Retrieval failed');
    }
  }

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
        0.8 as similarity
      FROM chunks c
      JOIN documents d ON c.doc_id = d.doc_id
      WHERE c.label = ANY($1)
        AND d.tenant = $2
      ORDER BY c.created_at DESC
      LIMIT $3
    `;
    
    const result = await this.db.query(queryText, [
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

  private getAllowedLabels(clearanceLevel: string): string[] {
    const labelHierarchy = {
      'public': ['Public'],
      'internal': ['Public', 'Internal'],
      'confidential': ['Public', 'Internal', 'Confidential'],
      'regulated': ['Public', 'Internal', 'Confidential', 'Regulated']
    };
    
    return labelHierarchy[clearanceLevel as keyof typeof labelHierarchy] || ['Public'];
  }

  async close(): Promise<void> {
    await this.db.end();
  }
}

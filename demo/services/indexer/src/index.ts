/**
 * Document Indexer Service
 * 
 * This service processes documents, classifies them, chunks content,
 * generates embeddings, and stores them in the database.
 */

import { Pool } from 'pg';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

export interface DocumentSource {
  doc_id: string;
  source: string;
  path: string;
  title: string;
  content: string;
  mime: string;
  owner_user_id: string;
  tenant: string;
}

export interface ClassificationResult {
  label: string;
  confidence: number;
  reasons: string[];
}

export interface Chunk {
  text: string;
  ord: number;
  label: string;
}

export class DocumentIndexer {
  private db: Pool;
  private classifierUrl: string;

  constructor(dbConfig: any, classifierUrl: string = 'http://classifier:8000') {
    this.db = new Pool(dbConfig);
    this.classifierUrl = classifierUrl;
  }

  /**
   * Process and index a document
   */
  async indexDocument(document: DocumentSource): Promise<void> {
    try {
      console.log(`Indexing document: ${document.title}`);
      
      // Step 1: Insert document record
      const docId = await this.insertDocument(document);
      
      // Step 2: Classify document
      const classification = await this.classifyDocument(document.content, {
        source: document.source,
        path: document.path,
        mime: document.mime
      });
      
      // Step 3: Store classification
      await this.storeClassification(docId, classification);
      
      // Step 4: Chunk content
      const chunks = this.chunkContent(document.content, classification.label);
      
      // Step 5: Generate embeddings and store chunks
      await this.storeChunks(docId, chunks, classification.label);
      
      console.log(`Successfully indexed document ${docId} with ${chunks.length} chunks`);
      
    } catch (error) {
      console.error(`Failed to index document ${document.title}:`, error);
      throw error;
    }
  }

  /**
   * Insert document record
   */
  private async insertDocument(document: DocumentSource): Promise<string> {
    const query = `
      INSERT INTO documents (doc_id, source, path, title, mime, owner_user_id, tenant)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING doc_id
    `;
    
    const result = await this.db.query(query, [
      document.doc_id,
      document.source,
      document.path,
      document.title,
      document.mime,
      document.owner_user_id,
      document.tenant
    ]);
    
    return result.rows[0].doc_id;
  }

  /**
   * Classify document using classifier service
   */
  private async classifyDocument(content: string, metadata: any): Promise<ClassificationResult> {
    try {
      const response = await axios.post(`${this.classifierUrl}/classify`, {
        text: content,
        metadata
      }, {
        timeout: 10000
      });
      
      return response.data;
    } catch (error) {
      console.warn('Classification failed, using default:', error);
      return {
        label: 'Internal',
        confidence: 0.5,
        reasons: ['Classification service unavailable, using default']
      };
    }
  }

  /**
   * Store classification result
   */
  private async storeClassification(docId: string, classification: ClassificationResult): Promise<void> {
    const query = `
      INSERT INTO document_labels (doc_id, label, confidence, reason)
      VALUES ($1, $2, $3, $4)
    `;
    
    await this.db.query(query, [
      docId,
      classification.label,
      classification.confidence,
      classification.reasons.join('; ')
    ]);
  }

  /**
   * Chunk content into manageable pieces
   */
  private chunkContent(content: string, label: string): Chunk[] {
    const targetSize = 600; // characters
    const overlap = 100; // characters
    const minSize = 200; // minimum chunk size
    
    const sentences = this.splitIntoSentences(content);
    const chunks: Chunk[] = [];
    let currentChunk = '';
    let chunkOrd = 0;
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      
      // If adding this sentence would exceed target size, finalize current chunk
      if (currentChunk.length + sentence.length > targetSize && currentChunk.length >= minSize) {
        chunks.push({
          text: currentChunk.trim(),
          ord: chunkOrd++,
          label
        });
        
        // Start new chunk with overlap
        const overlapText = this.getOverlapText(currentChunk, overlap);
        currentChunk = overlapText + sentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    }
    
    // Add final chunk if it has content
    if (currentChunk.trim().length >= minSize) {
      chunks.push({
        text: currentChunk.trim(),
        ord: chunkOrd++,
        label
      });
    }
    
    return chunks;
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    // Simple sentence splitting - in production, use NLP library
    return text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  }

  /**
   * Get overlap text from end of chunk
   */
  private getOverlapText(text: string, overlapSize: number): string {
    if (text.length <= overlapSize) return text;
    return text.slice(-overlapSize);
  }

  /**
   * Generate embedding for text (demo implementation)
   */
  private generateEmbedding(text: string): string {
    // This is a placeholder - in production, use actual embedding model
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
   * Simple hash function
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Store chunks with embeddings
   */
  private async storeChunks(docId: string, chunks: Chunk[], label: string): Promise<void> {
    const query = `
      INSERT INTO chunks (doc_id, ord, text, embedding, label)
      VALUES ($1, $2, $3, $4, $5)
    `;
    
    for (const chunk of chunks) {
      const embedding = this.generateEmbedding(chunk.text);
      
      await this.db.query(query, [
        docId,
        chunk.ord,
        chunk.text,
        embedding,
        label
      ]);
    }
  }

  /**
   * Process all documents from seed data
   */
  async processSeedDocuments(): Promise<void> {
    const seedDir = path.join(__dirname, '../../seed/sources');
    
    if (!fs.existsSync(seedDir)) {
      console.log('No seed documents found');
      return;
    }
    
    const files = fs.readdirSync(seedDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      try {
        const filePath = path.join(seedDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const documents = JSON.parse(content);
        
        for (const doc of documents) {
          await this.indexDocument(doc);
        }
        
        console.log(`Processed ${file}: ${documents.length} documents`);
      } catch (error) {
        console.error(`Failed to process ${file}:`, error);
      }
    }
  }

  /**
   * Get indexing statistics
   */
  async getIndexingStats(): Promise<any> {
    const query = `
      SELECT 
        COUNT(*) as total_documents,
        COUNT(DISTINCT source) as unique_sources,
        COUNT(DISTINCT tenant) as unique_tenants
      FROM documents
    `;
    
    const result = await this.db.query(query);
    return result.rows[0];
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.db.end();
  }
}

// CLI interface for running indexer
async function main() {
  const dbConfig = {
    host: process.env.POSTGRES_HOST || 'postgres',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'govrag',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres'
  };
  
  const indexer = new DocumentIndexer(dbConfig);
  
  try {
    console.log('Starting document indexing...');
    await indexer.processSeedDocuments();
    
    const stats = await indexer.getIndexingStats();
    console.log('Indexing complete:', stats);
    
  } catch (error) {
    console.error('Indexing failed:', error);
    process.exit(1);
  } finally {
    await indexer.close();
  }
}

if (require.main === module) {
  main();
}

export default DocumentIndexer;

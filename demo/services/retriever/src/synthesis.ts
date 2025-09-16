/**
 * Response Synthesis for Governed RAG
 * 
 * This module provides simple response synthesis without external LLM calls
 * for demo purposes.
 */

import { Chunk } from './retrieve';

export interface SynthesisRequest {
  chunks: Chunk[];
  query: string;
  maxLength: number;
}

export interface SynthesisResponse {
  response: string;
  sources: string[];
  confidence: number;
  insufficient_evidence: boolean;
}

export class ResponseSynthesizer {
  private maxResponseLength: number;

  constructor(maxResponseLength: number = 1000) {
    this.maxResponseLength = maxResponseLength;
  }

  /**
   * Synthesize response from chunks
   */
  synthesize(request: SynthesisRequest): SynthesisResponse {
    const { chunks, query, maxLength } = request;
    
    if (chunks.length === 0) {
      return {
        response: "No relevant information found for your query.",
        sources: [],
        confidence: 0,
        insufficient_evidence: true
      };
    }

    // Check evidence threshold
    const minEvidenceThreshold = 2;
    if (chunks.length < minEvidenceThreshold) {
      return {
        response: "Insufficient governed evidence to provide a reliable answer. Please refine your query or contact support for assistance.",
        sources: chunks.map(c => c.chunk_id),
        confidence: 0.3,
        insufficient_evidence: true
      };
    }

    // Sort chunks by similarity
    const sortedChunks = chunks.sort((a, b) => b.similarity - a.similarity);
    
    // Build response from top chunks
    let response = this.buildResponse(sortedChunks, query, maxLength);
    
    // Calculate confidence based on chunk quality and quantity
    const confidence = this.calculateConfidence(sortedChunks);
    
    // Extract sources
    const sources = [...new Set(sortedChunks.map(c => c.chunk_id))];
    
    return {
      response,
      sources,
      confidence,
      insufficient_evidence: false
    };
  }

  /**
   * Build response from chunks
   */
  private buildResponse(chunks: Chunk[], query: string, maxLength: number): string {
    const queryWords = query.toLowerCase().split(/\s+/);
    let response = `Based on the available information:\n\n`;
    
    let currentLength = response.length;
    const maxLengthToUse = Math.min(maxLength, this.maxResponseLength);
    
    for (let i = 0; i < chunks.length && currentLength < maxLengthToUse; i++) {
      const chunk = chunks[i];
      const chunkText = this.extractRelevantText(chunk.text, queryWords);
      
      if (chunkText && currentLength + chunkText.length < maxLengthToUse) {
        response += `• ${chunkText}\n\n`;
        currentLength += chunkText.length + 4; // +4 for "• " and "\n\n"
      }
    }
    
    // Add source attribution
    if (chunks.length > 0) {
      response += `\nThis information is based on ${chunks.length} document chunk(s) with classification levels: ${[...new Set(chunks.map(c => c.label))].join(', ')}.`;
    }
    
    return response.trim();
  }

  /**
   * Extract relevant text from chunk based on query
   */
  private extractRelevantText(text: string, queryWords: string[]): string {
    // Simple relevance scoring based on query word matches
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    let bestSentence = '';
    let bestScore = 0;
    
    for (const sentence of sentences) {
      const sentenceWords = sentence.toLowerCase().split(/\s+/);
      let score = 0;
      
      for (const queryWord of queryWords) {
        if (sentenceWords.includes(queryWord)) {
          score += 1;
        }
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestSentence = sentence.trim();
      }
    }
    
    // If no good sentence found, return first sentence
    if (bestSentence === '' && sentences.length > 0) {
      bestSentence = sentences[0].trim();
    }
    
    return bestSentence;
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(chunks: Chunk[]): number {
    if (chunks.length === 0) return 0;
    
    // Base confidence on number of chunks and their similarity scores
    const avgSimilarity = chunks.reduce((sum, c) => sum + c.similarity, 0) / chunks.length;
    const chunkCountFactor = Math.min(chunks.length / 5, 1); // Max at 5 chunks
    
    // Weighted combination
    const confidence = (avgSimilarity * 0.7) + (chunkCountFactor * 0.3);
    
    return Math.min(Math.max(confidence, 0), 1);
  }

  /**
   * Generate watermarked response for insufficient evidence
   */
  generateWatermarkedResponse(query: string): SynthesisResponse {
    return {
      response: `Insufficient governed evidence for query: "${query}". Please refine your search or contact support for assistance with this topic.`,
      sources: [],
      confidence: 0,
      insufficient_evidence: true
    };
  }

  /**
   * Validate response against policies
   */
  validateResponse(response: string, chunks: Chunk[]): boolean {
    // Check if response contains information from unauthorized chunks
    const authorizedLabels = ['Public', 'Internal', 'Confidential', 'Regulated'];
    const chunkLabels = chunks.map(c => c.label);
    
    // All chunks should have valid labels
    return chunkLabels.every(label => authorizedLabels.includes(label));
  }
}

// Export utility functions
export function synthesizeResponse(
  chunks: Chunk[],
  query: string,
  maxLength: number = 1000
): SynthesisResponse {
  const synthesizer = new ResponseSynthesizer();
  return synthesizer.synthesize({ chunks, query, maxLength });
}

export function generateWatermarkedResponse(query: string): SynthesisResponse {
  const synthesizer = new ResponseSynthesizer();
  return synthesizer.generateWatermarkedResponse(query);
}

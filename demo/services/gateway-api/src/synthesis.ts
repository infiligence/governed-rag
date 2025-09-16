/**
 * Simplified Response Synthesis for Gateway API
 */

import { Chunk } from './retriever';

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
        currentLength += chunkText.length + 4;
      }
    }
    
    // Add source attribution
    if (chunks.length > 0) {
      response += `\nThis information is based on ${chunks.length} document chunk(s) with classification levels: ${[...new Set(chunks.map(c => c.label))].join(', ')}.`;
    }
    
    return response.trim();
  }

  private extractRelevantText(text: string, queryWords: string[]): string {
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
    
    if (bestSentence === '' && sentences.length > 0) {
      bestSentence = sentences[0].trim();
    }
    
    return bestSentence;
  }

  private calculateConfidence(chunks: Chunk[]): number {
    if (chunks.length === 0) return 0;
    
    const avgSimilarity = chunks.reduce((sum, c) => sum + c.similarity, 0) / chunks.length;
    const chunkCountFactor = Math.min(chunks.length / 5, 1);
    
    const confidence = (avgSimilarity * 0.7) + (chunkCountFactor * 0.3);
    
    return Math.min(Math.max(confidence, 0), 1);
  }
}

export function synthesizeResponse(
  chunks: Chunk[],
  query: string,
  maxLength: number = 1000
): SynthesisResponse {
  const synthesizer = new ResponseSynthesizer();
  return synthesizer.synthesize({ chunks, query, maxLength });
}

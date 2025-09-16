/**
 * Simplified Redaction Library for Gateway API
 */

export interface RedactionResult {
  text: string;
  redaction_applied: boolean;
  patterns_matched: string[];
  chunks_processed: number;
}

export class RedactionService {
  private patterns: Map<string, RegExp> = new Map();

  constructor() {
    this.initializePatterns();
  }

  private initializePatterns(): void {
    // SSN pattern
    this.patterns.set('ssn', /\b(?!000|666)[0-8][0-9]{2}-?(?!00)[0-9]{2}-?(?!0000)[0-9]{4}\b/g);
    
    // Email pattern
    this.patterns.set('email', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g);
    
    // Phone pattern
    this.patterns.set('phone', /\b(?:\(?([0-9]{3})\)?[-. ]?)?([0-9]{3})[-. ]?([0-9]{4})\b/g);
    
    // Credit card pattern
    this.patterns.set('pan', /\b(?:\d[ -]*?){13,19}\b/g);
  }

  maskPII(text: string, classification: string = 'Internal'): RedactionResult {
    if (classification === 'Public') {
      return {
        text,
        redaction_applied: false,
        patterns_matched: [],
        chunks_processed: 1
      };
    }

    let maskedText = text;
    const patternsMatched: string[] = [];

    // Apply PII masking based on classification
    if (classification === 'Internal' || classification === 'Confidential' || classification === 'Regulated') {
      for (const [patternId, regex] of this.patterns) {
        const matches = regex.exec(maskedText);
        if (matches) {
          patternsMatched.push(patternId);
          
          maskedText = maskedText.replace(regex, (match) => {
            return this.applyMasking(match, patternId);
          });
        }
      }
    }

    return {
      text: maskedText,
      redaction_applied: patternsMatched.length > 0,
      patterns_matched: patternsMatched,
      chunks_processed: 1
    };
  }

  private applyMasking(match: string, patternId: string): string {
    switch (patternId) {
      case 'ssn':
        return 'XXX-XX-XXXX';
      case 'email':
        return '***@***.***';
      case 'phone':
        return '(XXX) XXX-XXXX';
      case 'pan':
        return '****-****-****-XXXX';
      default:
        return 'XXXX';
    }
  }
}

export const redactionService = new RedactionService();

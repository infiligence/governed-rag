/**
 * Redaction Library for PII/PHI Masking
 * 
 * This library provides functions to mask sensitive information in text
 * based on classification levels and redaction policies.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface PIIPattern {
  id: string;
  description: string;
  regex: string;
  mask?: string;
  mask_keep_last?: number;
  category: string;
}

export interface RedactionRule {
  label: string;
  action: 'none' | 'mask_pii' | 'mask_all' | 'deny_or_mask';
  description: string;
}

export interface RedactionConfig {
  patterns: PIIPattern[];
  redaction_rules: RedactionRule[];
  masking_options: {
    default_mask: string;
    preserve_format: boolean;
    keep_last_digits: number;
    custom_masks: Record<string, string>;
  };
}

export interface RedactionResult {
  text: string;
  redaction_applied: boolean;
  patterns_matched: string[];
  chunks_processed: number;
}

export class RedactionService {
  private config: RedactionConfig;
  private compiledPatterns: Map<string, RegExp> = new Map();

  constructor(configPath?: string) {
    try {
      const configFile = configPath || path.join(__dirname, '../../tech/redaction/pii_patterns.yaml');
      const configContent = fs.readFileSync(configFile, 'utf8');
      this.config = yaml.load(configContent) as RedactionConfig;
      
      // Compile regex patterns for performance
      this.compilePatterns();
    } catch (error) {
      console.warn('Failed to load redaction config, using defaults:', error);
      this.config = this.getDefaultConfig();
      this.compilePatterns();
    }
  }

  private getDefaultConfig(): RedactionConfig {
    return {
      patterns: [
        {
          id: 'ssn',
          description: 'US SSN',
          regex: '\\b(?!000|666)[0-8][0-9]{2}-?(?!00)[0-9]{2}-?(?!0000)[0-9]{4}\\b',
          mask: 'XXX-XX-XXXX',
          category: 'PII'
        },
        {
          id: 'pan',
          description: 'Payment card',
          regex: '\\b(?:\\d[ -]*?){13,19}\\b',
          mask_keep_last: 4,
          category: 'PII'
        },
        {
          id: 'email',
          description: 'Email address',
          regex: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b',
          mask: '***@***.***',
          category: 'PII'
        }
      ],
      redaction_rules: [
        { label: 'Public', action: 'none', description: 'No redaction' },
        { label: 'Internal', action: 'mask_pii', description: 'Mask PII only' },
        { label: 'Confidential', action: 'mask_all', description: 'Mask all sensitive info' },
        { label: 'Regulated', action: 'deny_or_mask', description: 'Deny or heavily mask' }
      ],
      masking_options: {
        default_mask: 'XXXX',
        preserve_format: true,
        keep_last_digits: 4,
        custom_masks: {
          ssn: 'XXX-XX-XXXX',
          pan: '****-****-****-XXXX',
          email: '***@***.***'
        }
      }
    };
  }

  private compilePatterns(): void {
    for (const pattern of this.config.patterns) {
      try {
        const regex = new RegExp(pattern.regex, 'gi');
        this.compiledPatterns.set(pattern.id, regex);
      } catch (error) {
        console.warn(`Failed to compile pattern ${pattern.id}:`, error);
      }
    }
  }

  /**
   * Mask PII in text based on classification level
   */
  public maskPII(text: string, classification: string = 'Internal'): RedactionResult {
    const rule = this.config.redaction_rules.find(r => r.label === classification);
    if (!rule || rule.action === 'none') {
      return {
        text,
        redaction_applied: false,
        patterns_matched: [],
        chunks_processed: 1
      };
    }

    let maskedText = text;
    const patternsMatched: string[] = [];

    // Apply PII masking based on rule
    if (rule.action === 'mask_pii' || rule.action === 'mask_all') {
      for (const [patternId, regex] of this.compiledPatterns) {
        const pattern = this.config.patterns.find(p => p.id === patternId);
        if (!pattern) continue;

        // Skip PHI patterns for mask_pii action
        if (rule.action === 'mask_pii' && pattern.category === 'PHI') {
          continue;
        }

        const matches = regex.exec(maskedText);
        if (matches) {
          patternsMatched.push(patternId);
          
          // Apply masking
          maskedText = maskedText.replace(regex, (match) => {
            return this.applyMasking(match, pattern);
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

  /**
   * Mask PHI (Protected Health Information) specifically
   */
  public maskPHI(text: string): RedactionResult {
    let maskedText = text;
    const patternsMatched: string[] = [];

    for (const [patternId, regex] of this.compiledPatterns) {
      const pattern = this.config.patterns.find(p => p.id === patternId);
      if (!pattern || pattern.category !== 'PHI') continue;

      const matches = regex.exec(maskedText);
      if (matches) {
        patternsMatched.push(patternId);
        maskedText = maskedText.replace(regex, (match) => {
          return this.applyMasking(match, pattern);
        });
      }
    }

    return {
      text: maskedText,
      redaction_applied: patternsMatched.length > 0,
      patterns_matched: patternsMatched,
      chunks_processed: 1
    };
  }

  /**
   * Scrub prompt for LLM calls to remove sensitive information
   */
  public scrubPrompt(prompt: string): string {
    // Remove all PII/PHI from prompt
    const piiResult = this.maskPII(prompt, 'Confidential');
    const phiResult = this.maskPHI(piiResult.text);
    
    return phiResult.text;
  }

  /**
   * Apply masking to a matched string based on pattern configuration
   */
  private applyMasking(match: string, pattern: PIIPattern): string {
    if (pattern.mask) {
      return pattern.mask;
    }

    if (pattern.mask_keep_last) {
      const keepLast = pattern.mask_keep_last;
      if (match.length <= keepLast) {
        return this.config.masking_options.default_mask;
      }
      
      const lastDigits = match.slice(-keepLast);
      const masked = this.config.masking_options.default_mask;
      return `${masked}-${lastDigits}`;
    }

    return this.config.masking_options.default_mask;
  }

  /**
   * Get available patterns
   */
  public getPatterns(): PIIPattern[] {
    return this.config.patterns;
  }

  /**
   * Get redaction rules
   */
  public getRedactionRules(): RedactionRule[] {
    return this.config.redaction_rules;
  }

  /**
   * Test redaction on sample text
   */
  public testRedaction(text: string, classification: string = 'Internal'): void {
    console.log(`\nTesting redaction for classification: ${classification}`);
    console.log(`Original text: ${text}`);
    
    const result = this.maskPII(text, classification);
    console.log(`Redacted text: ${result.text}`);
    console.log(`Patterns matched: ${result.patterns_matched.join(', ')}`);
    console.log(`Redaction applied: ${result.redaction_applied}`);
  }
}

// Export singleton instance
export const redactionService = new RedactionService();

// Export utility functions
export function maskPII(text: string, classification: string = 'Internal'): RedactionResult {
  return redactionService.maskPII(text, classification);
}

export function maskPHI(text: string): RedactionResult {
  return redactionService.maskPHI(text);
}

export function scrubPrompt(prompt: string): string {
  return redactionService.scrubPrompt(prompt);
}

"""
Redaction Service - PII/PHI Masking

This service provides pattern-based and context-aware redaction of sensitive
information based on document classification and policy rules.
"""

import re
import yaml
import logging
from typing import List, Dict, Any, Optional
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Redaction Service", version="1.0.0")

# Load PII patterns
PII_PATTERNS_PATH = Path("/app/tech/redaction/pii_patterns.yaml")

class RedactionRequest(BaseModel):
    text: str
    classification: str = "Internal"
    redaction_level: str = "standard"  # minimal, standard, strict
    context: Optional[Dict[str, Any]] = {}

class RedactionResponse(BaseModel):
    original_length: int
    redacted_length: int
    redaction_applied: bool
    patterns_matched: List[str]
    redacted_text: str
    redaction_count: int

class RedactionPattern(BaseModel):
    id: str
    type: str
    regex: str
    replacement: str
    sensitivity: str  # low, medium, high, critical

class RedactionService:
    def __init__(self):
        self.patterns: List[RedactionPattern] = []
        self.load_patterns()
    
    def load_patterns(self):
        """Load PII patterns from YAML file."""
        try:
            if PII_PATTERNS_PATH.exists():
                with open(PII_PATTERNS_PATH, 'r') as f:
                    data = yaml.safe_load(f)
                    for pattern_data in data.get('patterns', []):
                        pattern = RedactionPattern(
                            id=pattern_data['id'],
                            type=pattern_data.get('type', 'pii'),
                            regex=pattern_data['regex'],
                            replacement=pattern_data.get('replacement', '[REDACTED]'),
                            sensitivity=pattern_data.get('sensitivity', 'medium')
                        )
                        self.patterns.append(pattern)
                logger.info(f"Loaded {len(self.patterns)} redaction patterns")
            else:
                logger.warning(f"Patterns file not found: {PII_PATTERNS_PATH}")
                self.patterns = self.get_default_patterns()
        except Exception as e:
            logger.error(f"Failed to load patterns: {e}")
            self.patterns = self.get_default_patterns()
    
    def get_default_patterns(self) -> List[RedactionPattern]:
        """Return default redaction patterns."""
        return [
            RedactionPattern(
                id="ssn",
                type="pii",
                regex=r"\b(?!000|666)[0-8][0-9]{2}-?(?!00)[0-9]{2}-?(?!0000)[0-9]{4}\b",
                replacement="XXX-XX-XXXX",
                sensitivity="critical"
            ),
            RedactionPattern(
                id="email",
                type="pii",
                regex=r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
                replacement="***@***.***",
                sensitivity="medium"
            ),
            RedactionPattern(
                id="phone",
                type="pii",
                regex=r"\b(?:\(?([0-9]{3})\)?[-. ]?)?([0-9]{3})[-. ]?([0-9]{4})\b",
                replacement="(XXX) XXX-XXXX",
                sensitivity="medium"
            ),
            RedactionPattern(
                id="pan",
                type="financial",
                regex=r"\b(?:\d[ -]*?){13,19}\b",
                replacement="****-****-****-XXXX",
                sensitivity="critical"
            ),
            RedactionPattern(
                id="date_of_birth",
                type="phi",
                regex=r"\b(?:0[1-9]|1[0-2])[/-](?:0[1-9]|[12][0-9]|3[01])[/-](?:19|20)\d{2}\b",
                replacement="XX/XX/XXXX",
                sensitivity="high"
            ),
            RedactionPattern(
                id="ip_address",
                type="technical",
                regex=r"\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b",
                replacement="XXX.XXX.XXX.XXX",
                sensitivity="low"
            ),
            RedactionPattern(
                id="address",
                type="pii",
                regex=r"\b\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b",
                replacement="[ADDRESS REDACTED]",
                sensitivity="medium"
            )
        ]
    
    def redact_text(
        self,
        text: str,
        classification: str,
        redaction_level: str,
        context: Dict[str, Any]
    ) -> RedactionResponse:
        """Apply redaction based on classification and level."""
        original_length = len(text)
        redacted_text = text
        patterns_matched: List[str] = []
        redaction_count = 0
        
        # Determine which patterns to apply based on classification
        patterns_to_apply = self.get_patterns_for_classification(
            classification,
            redaction_level
        )
        
        # Apply each pattern
        for pattern in patterns_to_apply:
            try:
                compiled_pattern = re.compile(pattern.regex, re.IGNORECASE)
                matches = compiled_pattern.findall(redacted_text)
                
                if matches:
                    patterns_matched.append(pattern.id)
                    redaction_count += len(matches)
                    redacted_text = compiled_pattern.sub(pattern.replacement, redacted_text)
                    
            except re.error as e:
                logger.error(f"Invalid regex for pattern {pattern.id}: {e}")
        
        redacted_length = len(redacted_text)
        
        return RedactionResponse(
            original_length=original_length,
            redacted_length=redacted_length,
            redaction_applied=len(patterns_matched) > 0,
            patterns_matched=patterns_matched,
            redacted_text=redacted_text,
            redaction_count=redaction_count
        )
    
    def get_patterns_for_classification(
        self,
        classification: str,
        redaction_level: str
    ) -> List[RedactionPattern]:
        """Get redaction patterns based on classification and level."""
        # Public documents: minimal redaction
        if classification == "Public":
            if redaction_level == "minimal":
                return []
            elif redaction_level == "standard":
                return [p for p in self.patterns if p.sensitivity in ["critical"]]
            else:  # strict
                return [p for p in self.patterns if p.sensitivity in ["critical", "high"]]
        
        # Internal documents: standard redaction
        elif classification == "Internal":
            if redaction_level == "minimal":
                return [p for p in self.patterns if p.sensitivity in ["critical"]]
            elif redaction_level == "standard":
                return [p for p in self.patterns if p.sensitivity in ["critical", "high"]]
            else:  # strict
                return [p for p in self.patterns if p.sensitivity in ["critical", "high", "medium"]]
        
        # Confidential documents: aggressive redaction
        elif classification == "Confidential":
            if redaction_level == "minimal":
                return [p for p in self.patterns if p.sensitivity in ["critical", "high"]]
            elif redaction_level == "standard":
                return [p for p in self.patterns if p.sensitivity in ["critical", "high", "medium"]]
            else:  # strict
                return self.patterns  # All patterns
        
        # Regulated documents: maximum redaction
        elif classification == "Regulated":
            # Always use all patterns for regulated content
            return self.patterns
        
        else:
            # Unknown classification: use standard redaction
            return [p for p in self.patterns if p.sensitivity in ["critical", "high"]]
    
    def detect_pii(self, text: str) -> Dict[str, Any]:
        """Detect PII without redaction (for analysis)."""
        detections: Dict[str, List[str]] = {}
        total_count = 0
        
        for pattern in self.patterns:
            try:
                compiled_pattern = re.compile(pattern.regex, re.IGNORECASE)
                matches = compiled_pattern.findall(text)
                
                if matches:
                    detections[pattern.id] = matches
                    total_count += len(matches)
                    
            except re.error as e:
                logger.error(f"Invalid regex for pattern {pattern.id}: {e}")
        
        return {
            "pii_detected": total_count > 0,
            "total_count": total_count,
            "patterns": detections,
            "sensitivity_breakdown": self.categorize_by_sensitivity(detections)
        }
    
    def categorize_by_sensitivity(self, detections: Dict[str, List[str]]) -> Dict[str, int]:
        """Categorize detections by sensitivity level."""
        breakdown = {
            "critical": 0,
            "high": 0,
            "medium": 0,
            "low": 0
        }
        
        for pattern_id in detections:
            pattern = next((p for p in self.patterns if p.id == pattern_id), None)
            if pattern:
                breakdown[pattern.sensitivity] += len(detections[pattern_id])
        
        return breakdown

# Initialize service
redaction_service = RedactionService()

@app.post("/redact", response_model=RedactionResponse)
async def redact_text(request: RedactionRequest):
    """Redact sensitive information from text."""
    try:
        result = redaction_service.redact_text(
            request.text,
            request.classification,
            request.redaction_level,
            request.context
        )
        
        logger.info(
            f"Redaction: classification={request.classification}, "
            f"level={request.redaction_level}, "
            f"patterns={len(result.patterns_matched)}, "
            f"count={result.redaction_count}"
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Redaction error: {e}")
        raise HTTPException(status_code=500, detail=f"Redaction failed: {str(e)}")

@app.post("/detect")
async def detect_pii(request: RedactionRequest):
    """Detect PII without redacting."""
    try:
        result = redaction_service.detect_pii(request.text)
        logger.info(f"PII detection: found={result['total_count']} instances")
        return result
        
    except Exception as e:
        logger.error(f"PII detection error: {e}")
        raise HTTPException(status_code=500, detail=f"Detection failed: {str(e)}")

@app.get("/patterns")
async def get_patterns():
    """Get available redaction patterns."""
    return {
        "patterns": [
            {
                "id": p.id,
                "type": p.type,
                "sensitivity": p.sensitivity
            }
            for p in redaction_service.patterns
        ],
        "total": len(redaction_service.patterns)
    }

@app.post("/patterns/reload")
async def reload_patterns():
    """Reload patterns from file."""
    try:
        redaction_service.load_patterns()
        return {
            "message": "Patterns reloaded",
            "count": len(redaction_service.patterns)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reload patterns: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "redactor",
        "patterns_loaded": len(redaction_service.patterns)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3007)


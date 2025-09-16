"""
Document Classification Service

This service classifies documents based on content analysis using hybrid rules
and simple ML techniques for demo purposes.
"""

import re
import json
import yaml
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Document Classifier", version="1.0.0")

# Load PII patterns
try:
    with open("/app/tech/redaction/pii_patterns.yaml", "r") as f:
        pii_patterns = yaml.safe_load(f)
except FileNotFoundError:
    # Fallback patterns if file not found
    pii_patterns = {
        "patterns": [
            {"id": "ssn", "regex": r"\b(?!000|666)[0-8][0-9]{2}-?(?!00)[0-9]{2}-?(?!0000)[0-9]{4}\b"},
            {"id": "pan", "regex": r"\b(?:\\d[ -]*?){13,19}\b"},
            {"id": "email", "regex": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"}
        ]
    }

class ClassificationRequest(BaseModel):
    text: str
    metadata: Optional[Dict[str, Any]] = {}

class ClassificationResponse(BaseModel):
    label: str
    confidence: float
    reasons: List[str]

class ClassificationService:
    def __init__(self):
        self.patterns = pii_patterns.get("patterns", [])
        self.compiled_patterns = {}
        
        # Compile regex patterns for performance
        for pattern in self.patterns:
            try:
                self.compiled_patterns[pattern["id"]] = re.compile(pattern["regex"], re.IGNORECASE)
            except re.error as e:
                logger.warning(f"Invalid regex pattern {pattern['id']}: {e}")
    
    def classify_document(self, text: str, metadata: Dict[str, Any] = None) -> ClassificationResponse:
        """Classify document based on content analysis."""
        if metadata is None:
            metadata = {}
        
        reasons = []
        confidence = 0.0
        
        # Check for sensitive patterns
        sensitive_patterns_found = self._check_sensitive_patterns(text)
        
        # Check for keywords indicating classification level
        keyword_scores = self._analyze_keywords(text)
        
        # Check metadata hints
        metadata_hints = self._analyze_metadata(metadata)
        
        # Determine classification
        if sensitive_patterns_found["regulated"] or keyword_scores["regulated"] > 0.7:
            label = "Regulated"
            confidence = 0.9
            reasons.append("Contains regulated data patterns or keywords")
        elif sensitive_patterns_found["confidential"] or keyword_scores["confidential"] > 0.6:
            label = "Confidential"
            confidence = 0.8
            reasons.append("Contains confidential information")
        elif sensitive_patterns_found["internal"] or keyword_scores["internal"] > 0.5:
            label = "Internal"
            confidence = 0.7
            reasons.append("Contains internal business information")
        else:
            label = "Public"
            confidence = 0.6
            reasons.append("No sensitive patterns detected")
        
        # Adjust confidence based on metadata
        if metadata_hints:
            confidence = min(confidence + 0.1, 1.0)
            reasons.append(f"Metadata hints: {metadata_hints}")
        
        return ClassificationResponse(
            label=label,
            confidence=confidence,
            reasons=reasons
        )
    
    def _check_sensitive_patterns(self, text: str) -> Dict[str, bool]:
        """Check for sensitive data patterns."""
        results = {
            "regulated": False,
            "confidential": False,
            "internal": False
        }
        
        # Check for regulated patterns (PHI, financial data)
        regulated_patterns = ["ssn", "pan", "routing", "icd10", "credit_score"]
        for pattern_id in regulated_patterns:
            if pattern_id in self.compiled_patterns:
                if self.compiled_patterns[pattern_id].search(text):
                    results["regulated"] = True
                    break
        
        # Check for confidential patterns (PII, business data)
        confidential_patterns = ["email", "phone", "address", "dob"]
        for pattern_id in confidential_patterns:
            if pattern_id in self.compiled_patterns:
                if self.compiled_patterns[pattern_id].search(text):
                    results["confidential"] = True
                    break
        
        # Check for internal patterns (business terms)
        internal_keywords = ["strategy", "budget", "revenue", "confidential", "proprietary"]
        for keyword in internal_keywords:
            if keyword.lower() in text.lower():
                results["internal"] = True
                break
        
        return results
    
    def _analyze_keywords(self, text: str) -> Dict[str, float]:
        """Analyze text for classification keywords."""
        text_lower = text.lower()
        
        # Keyword dictionaries with weights
        regulated_keywords = {
            "medical": 0.3, "health": 0.3, "patient": 0.4, "diagnosis": 0.4,
            "treatment": 0.3, "prescription": 0.4, "insurance": 0.3,
            "financial": 0.2, "bank": 0.3, "account": 0.2, "credit": 0.3,
            "ssn": 0.5, "social security": 0.5, "tax id": 0.4
        }
        
        confidential_keywords = {
            "personal": 0.3, "private": 0.3, "sensitive": 0.4, "confidential": 0.5,
            "proprietary": 0.4, "internal": 0.3, "restricted": 0.4,
            "email": 0.2, "phone": 0.2, "address": 0.2
        }
        
        internal_keywords = {
            "business": 0.2, "company": 0.2, "strategy": 0.3, "plan": 0.2,
            "budget": 0.3, "revenue": 0.3, "profit": 0.2, "meeting": 0.1,
            "project": 0.2, "team": 0.1, "department": 0.2
        }
        
        # Calculate scores
        regulated_score = sum(weight for keyword, weight in regulated_keywords.items() 
                            if keyword in text_lower)
        confidential_score = sum(weight for keyword, weight in confidential_keywords.items() 
                               if keyword in text_lower)
        internal_score = sum(weight for keyword, weight in internal_keywords.items() 
                           if keyword in text_lower)
        
        return {
            "regulated": min(regulated_score, 1.0),
            "confidential": min(confidential_score, 1.0),
            "internal": min(internal_score, 1.0)
        }
    
    def _analyze_metadata(self, metadata: Dict[str, Any]) -> str:
        """Analyze metadata for classification hints."""
        hints = []
        
        # Check source
        source = metadata.get("source", "").lower()
        if "legal" in source or "compliance" in source:
            hints.append("legal source")
        elif "hr" in source or "personnel" in source:
            hints.append("HR source")
        elif "finance" in source or "accounting" in source:
            hints.append("financial source")
        
        # Check file type
        file_type = metadata.get("mime", "").lower()
        if "spreadsheet" in file_type or "excel" in file_type:
            hints.append("spreadsheet format")
        
        # Check path
        path = metadata.get("path", "").lower()
        if "confidential" in path or "private" in path:
            hints.append("confidential path")
        elif "internal" in path:
            hints.append("internal path")
        
        return ", ".join(hints) if hints else ""

# Initialize classifier service
classifier_service = ClassificationService()

@app.post("/classify", response_model=ClassificationResponse)
async def classify_document(request: ClassificationRequest):
    """Classify a document based on its content and metadata."""
    try:
        result = classifier_service.classify_document(request.text, request.metadata)
        logger.info(f"Classified document as {result.label} with confidence {result.confidence}")
        return result
    except Exception as e:
        logger.error(f"Classification error: {e}")
        raise HTTPException(status_code=500, detail=f"Classification failed: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "classifier"}

@app.get("/patterns")
async def get_patterns():
    """Get available PII patterns."""
    return {"patterns": [p["id"] for p in self.patterns]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

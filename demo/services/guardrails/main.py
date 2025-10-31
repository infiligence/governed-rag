"""
Guardrails Service - YAML DSL Executor

This service executes guardrail policies defined in YAML format to enforce
business logic, safety constraints, and compliance rules on RAG outputs.
"""

import re
import yaml
import logging
from typing import List, Dict, Any, Optional
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import aiohttp

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Guardrails Service", version="1.0.0")

# Load guardrails DSL configuration
GUARDRAILS_CONFIG_PATH = Path("/app/tech/guardrails/guardrails.dsl.yaml")

class GuardrailCheck(BaseModel):
    id: str
    when: str  # pre_generation, post_generation, pre_return
    run: Dict[str, Any]
    assert_rules: List[Dict[str, Any]]
    on_fail: Dict[str, str]

class GuardrailsConfig(BaseModel):
    version: str
    checks: List[GuardrailCheck]

class GuardrailRequest(BaseModel):
    text: str
    context: Optional[Dict[str, Any]] = {}
    stage: str = "post_generation"  # pre_generation, post_generation, pre_return

class GuardrailResponse(BaseModel):
    passed: bool
    failed_checks: List[str]
    warnings: List[str]
    actions_taken: List[str]
    modified_text: Optional[str] = None

class GuardrailsEngine:
    def __init__(self):
        self.config: Optional[GuardrailsConfig] = None
        self.load_config()
    
    def load_config(self):
        """Load guardrails configuration from YAML file."""
        try:
            if GUARDRAILS_CONFIG_PATH.exists():
                with open(GUARDRAILS_CONFIG_PATH, 'r') as f:
                    config_data = yaml.safe_load(f)
                    self.config = self.parse_config(config_data)
                    logger.info(f"Loaded {len(self.config.checks)} guardrail checks")
            else:
                logger.warning(f"Config file not found: {GUARDRAILS_CONFIG_PATH}")
                self.config = self.get_default_config()
        except Exception as e:
            logger.error(f"Failed to load config: {e}")
            self.config = self.get_default_config()
    
    def parse_config(self, config_data: Dict[str, Any]) -> GuardrailsConfig:
        """Parse YAML config into GuardrailsConfig model."""
        checks = []
        for check_data in config_data.get('checks', []):
            check = GuardrailCheck(
                id=check_data['id'],
                when=check_data['when'],
                run=check_data['run'],
                assert_rules=check_data.get('assert', []),
                on_fail=check_data.get('on_fail', {})
            )
            checks.append(check)
        
        return GuardrailsConfig(
            version=config_data.get('version', '0.1'),
            checks=checks
        )
    
    def get_default_config(self) -> GuardrailsConfig:
        """Return default guardrails configuration."""
        return GuardrailsConfig(
            version="0.1",
            checks=[
                GuardrailCheck(
                    id="pii_leakage",
                    when="pre_return",
                    run={"type": "pii_scan", "input": "{{answer}}"},
                    assert_rules=[{"op": "eq", "key": "detected", "value": False}],
                    on_fail={"action": "mask_and_log", "message": "PII detected in response"}
                ),
                GuardrailCheck(
                    id="toxicity_check",
                    when="post_generation",
                    run={"type": "toxicity_scan", "input": "{{answer}}"},
                    assert_rules=[{"op": "lte", "key": "score", "value": 0.3}],
                    on_fail={"action": "refuse", "message": "Content failed toxicity check"}
                ),
                GuardrailCheck(
                    id="length_check",
                    when="post_generation",
                    run={"type": "length_check", "input": "{{answer}}"},
                    assert_rules=[
                        {"op": "gte", "key": "length", "value": 10},
                        {"op": "lte", "key": "length", "value": 5000}
                    ],
                    on_fail={"action": "truncate", "message": "Response length out of bounds"}
                )
            ]
        )
    
    async def execute_guardrails(
        self,
        text: str,
        context: Dict[str, Any],
        stage: str
    ) -> GuardrailResponse:
        """Execute all guardrail checks for the given stage."""
        if not self.config:
            return GuardrailResponse(
                passed=True,
                failed_checks=[],
                warnings=["No guardrails configured"],
                actions_taken=[]
            )
        
        failed_checks: List[str] = []
        warnings: List[str] = []
        actions_taken: List[str] = []
        modified_text = text
        
        # Filter checks by stage
        relevant_checks = [c for c in self.config.checks if c.when == stage]
        
        for check in relevant_checks:
            try:
                # Execute the check
                result = await self.run_check(check, modified_text, context)
                
                # Evaluate assertions
                passed = self.evaluate_assertions(check.assert_rules, result)
                
                if not passed:
                    failed_checks.append(check.id)
                    
                    # Execute failure action
                    action = check.on_fail.get('action', 'log')
                    message = check.on_fail.get('message', f'Check {check.id} failed')
                    
                    if action == 'refuse':
                        actions_taken.append(f"Refused: {message}")
                        modified_text = f"[BLOCKED: {message}]"
                    elif action == 'mask_and_log':
                        actions_taken.append(f"Masked: {message}")
                        modified_text = self.mask_sensitive_content(modified_text, result)
                    elif action == 'fallback_or_refuse':
                        actions_taken.append(f"Fallback: {message}")
                        modified_text = "I cannot provide a confident answer to this query."
                    elif action == 'truncate':
                        actions_taken.append(f"Truncated: {message}")
                        modified_text = modified_text[:5000]
                    else:
                        warnings.append(message)
                
            except Exception as e:
                logger.error(f"Error executing check {check.id}: {e}")
                warnings.append(f"Check {check.id} encountered an error")
        
        return GuardrailResponse(
            passed=len(failed_checks) == 0,
            failed_checks=failed_checks,
            warnings=warnings,
            actions_taken=actions_taken,
            modified_text=modified_text if modified_text != text else None
        )
    
    async def run_check(
        self,
        check: GuardrailCheck,
        text: str,
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Run a specific guardrail check."""
        check_type = check.run.get('type')
        
        if check_type == 'pii_scan':
            return self.scan_pii(text)
        elif check_type == 'toxicity_scan':
            return await self.scan_toxicity(text)
        elif check_type == 'hallucination_score':
            return await self.check_hallucination(text, context)
        elif check_type == 'length_check':
            return {"length": len(text)}
        elif check_type == 'llm_judge':
            return await self.llm_judge(text, context)
        else:
            logger.warning(f"Unknown check type: {check_type}")
            return {"score": 0, "detected": False}
    
    def scan_pii(self, text: str) -> Dict[str, Any]:
        """Scan text for PII patterns."""
        pii_patterns = {
            'ssn': r'\b(?!000|666)[0-8][0-9]{2}-?(?!00)[0-9]{2}-?(?!0000)[0-9]{4}\b',
            'email': r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
            'phone': r'\b(?:\(?([0-9]{3})\)?[-. ]?)?([0-9]{3})[-. ]?([0-9]{4})\b',
            'credit_card': r'\b(?:\d[ -]*?){13,19}\b'
        }
        
        detected_types = []
        for pii_type, pattern in pii_patterns.items():
            if re.search(pattern, text, re.IGNORECASE):
                detected_types.append(pii_type)
        
        return {
            "detected": len(detected_types) > 0,
            "types": detected_types,
            "count": len(detected_types)
        }
    
    async def scan_toxicity(self, text: str) -> Dict[str, Any]:
        """Scan text for toxic content (simplified implementation)."""
        toxic_keywords = [
            'hate', 'violence', 'offensive', 'discriminatory',
            'explicit', 'inappropriate', 'threatening'
        ]
        
        text_lower = text.lower()
        toxic_count = sum(1 for keyword in toxic_keywords if keyword in text_lower)
        
        # Simple scoring: 0-1 scale
        score = min(toxic_count / 10, 1.0)
        
        return {
            "score": score,
            "is_toxic": score > 0.3,
            "matches": toxic_count
        }
    
    async def check_hallucination(
        self,
        text: str,
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Check for potential hallucinations (simplified)."""
        # In production, this would use an LLM or specialized model
        # For demo, we check for certain patterns
        
        confidence_phrases = [
            "i think", "maybe", "possibly", "might be",
            "not sure", "uncertain", "could be"
        ]
        
        text_lower = text.lower()
        uncertainty_count = sum(1 for phrase in confidence_phrases if phrase in text_lower)
        
        # More uncertainty = higher hallucination risk
        score = min(uncertainty_count / 5, 1.0)
        
        return {
            "score": score,
            "confidence": 1 - score,
            "uncertainty_markers": uncertainty_count
        }
    
    async def llm_judge(self, text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Use LLM to judge response quality (simplified)."""
        # In production, this would call an LLM API
        # For demo, we do basic quality checks
        
        quality_score = 0.8
        
        # Check if response is too short
        if len(text) < 50:
            quality_score -= 0.3
        
        # Check if response seems complete
        if not text.endswith(('.', '!', '?')):
            quality_score -= 0.2
        
        quality_score = max(0, min(quality_score, 1.0))
        
        return {
            "score": quality_score,
            "quality": "good" if quality_score > 0.7 else "poor"
        }
    
    def evaluate_assertions(
        self,
        assertions: List[Dict[str, Any]],
        result: Dict[str, Any]
    ) -> bool:
        """Evaluate assertion rules against check results."""
        for assertion in assertions:
            op = assertion.get('op')
            key = assertion.get('key')
            value = assertion.get('value')
            
            actual_value = result.get(key)
            
            if op == 'eq' and actual_value != value:
                return False
            elif op == 'ne' and actual_value == value:
                return False
            elif op == 'gt' and not (actual_value > value):
                return False
            elif op == 'gte' and not (actual_value >= value):
                return False
            elif op == 'lt' and not (actual_value < value):
                return False
            elif op == 'lte' and not (actual_value <= value):
                return False
        
        return True
    
    def mask_sensitive_content(self, text: str, scan_result: Dict[str, Any]) -> str:
        """Mask sensitive content detected in text."""
        masked_text = text
        
        # Mask PII patterns
        pii_patterns = {
            'ssn': (r'\b(?!000|666)[0-8][0-9]{2}-?(?!00)[0-9]{2}-?(?!0000)[0-9]{4}\b', 'XXX-XX-XXXX'),
            'email': (r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '***@***.***'),
            'phone': (r'\b(?:\(?([0-9]{3})\)?[-. ]?)?([0-9]{3})[-. ]?([0-9]{4})\b', '(XXX) XXX-XXXX'),
            'credit_card': (r'\b(?:\d[ -]*?){13,19}\b', '****-****-****-XXXX')
        }
        
        for pii_type, (pattern, replacement) in pii_patterns.items():
            masked_text = re.sub(pattern, replacement, masked_text, flags=re.IGNORECASE)
        
        return masked_text

# Initialize engine
guardrails_engine = GuardrailsEngine()

@app.post("/guardrails/check", response_model=GuardrailResponse)
async def check_guardrails(request: GuardrailRequest):
    """Execute guardrails checks on text."""
    try:
        result = await guardrails_engine.execute_guardrails(
            request.text,
            request.context,
            request.stage
        )
        
        logger.info(
            f"Guardrails check: stage={request.stage}, "
            f"passed={result.passed}, "
            f"failed={len(result.failed_checks)}"
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Guardrails check error: {e}")
        raise HTTPException(status_code=500, detail=f"Guardrails check failed: {str(e)}")

@app.get("/guardrails/config")
async def get_config():
    """Get current guardrails configuration."""
    if not guardrails_engine.config:
        raise HTTPException(status_code=404, detail="No configuration loaded")
    
    return {
        "version": guardrails_engine.config.version,
        "checks": [
            {
                "id": check.id,
                "when": check.when,
                "type": check.run.get('type')
            }
            for check in guardrails_engine.config.checks
        ]
    }

@app.post("/guardrails/reload")
async def reload_config():
    """Reload guardrails configuration from file."""
    try:
        guardrails_engine.load_config()
        return {
            "message": "Configuration reloaded",
            "checks_loaded": len(guardrails_engine.config.checks) if guardrails_engine.config else 0
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reload config: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "guardrails",
        "config_loaded": guardrails_engine.config is not None
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3006)


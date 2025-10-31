# Next-Gen Extensions - Single Page Summary

This document mirrors the README section on Next-Gen Extensions and serves as a comprehensive reference for extending the Governed RAG system with production-grade capabilities.

## Overview

The Governed RAG system can be extended with the following capabilities while preserving zero-trust guarantees:

1. **Dynamic Policy Learning** — Auto-suggest OPA/Cedar rule updates from audit + usage deltas.
2. **Federated Retrieval** — Query multiple governed indexes with per-source policy enforcement.
3. **Explainable Access** — Show the exact policy, attributes, and evidence that allowed/blocked each chunk.
4. **Self-Healing Policies** — Detect PDP–service drift and auto-generate corrective patches with tests.
5. **Data Lineage Graph** — Provenance across source → classify → redact → retrieve → answer.
6. **Guardrails DSL** — Declarative checks (hallucination, sensitive data leakage, tone, jailbreaks).
7. **Continuous Compliance Simulator** — Scheduled role-based probes to catch policy leaks.
8. **Adaptive Redaction** — Semantic masking using LLM+NER ensembles; confidence-weighted.
9. **Policy-Driven Prompt Orchestration** — Role/classification-aware prompt clauses and response headers.
10. **Tamper-Evident Ledger** — Append-only hash chain for policy and high-risk reads.

## Implementation References

### Guardrails DSL
- **Starter**: `tech/guardrails/guardrails.dsl.yaml`
- **Example**: `tech/guardrails/examples/hallucination-policy.yaml`
- **TODO**: Hook DSL checks in gateway and retriever services

### Self-Healing Policies
- **Documentation**: `tech/policies/self_healing_policies.md`
- **TODO**: Implement drift detectors and CI probes

### Data Lineage
- **Documentation**: `tech/lineage/lineage.md`
- **TODO**: Emit lineage events from gateway, retriever, and redactor

### Compliance Simulator
- **Script**: `demo/scripts/simulate_compliance.sh`
- **TODO**: Replace stub with actual gateway calls

## Next Steps

1. Implement runtime hooks for guardrails DSL in gateway service
2. Build drift detection system for self-healing policies
3. Add lineage event emission to core services
4. Enhance compliance simulator with real authentication tokens
5. Add CI/CD integration for automated policy testing


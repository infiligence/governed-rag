# Audit Model and Event Tracking

## Overview

The audit system provides comprehensive logging and monitoring capabilities for the governed RAG system, ensuring compliance, security, and accountability.

## Audit Event Model

### Core Event Structure
```typescript
interface AuditEvent {
  event_id: string;           // Unique identifier
  ts: Date;                   // Timestamp
  actor_user_id: string;      // User who performed action
  action: string;             // Action performed
  object_id?: string;         // Target object identifier
  object_type?: string;       // Type of object
  policy_decision: string;    // ALLOW/DENY/STEP_UP_REQUIRED
  reason?: string;            // Human-readable explanation
  hash: string;               // Cryptographic hash
  prev_hash?: string;         // Previous event hash (chain)
  metadata: object;           // Additional context
}
```

### Event Types

#### Query Events
- `QUERY_ISSUED`: User initiated a search query
- `CANDIDATES_FILTERED`: Pre-filtering results
- `PDP_DENY`: Policy decision point denied access
- `STEP_UP_REQUIRED`: MFA required for access
- `STEP_UP_OK`: MFA successfully completed
- `REDACTION_APPLIED`: PII/PHI redaction applied
- `RESULT_RETURNED`: Search results returned to user

#### Access Events
- `DOCUMENT_ACCESSED`: Document was accessed
- `CHUNK_RETRIEVED`: Document chunk was retrieved
- `EXPORT_ATTEMPTED`: Export was attempted
- `EXPORT_DENIED`: Export was blocked by policy
- `EXPORT_GRANTED`: Export was allowed

#### System Events
- `CLASSIFICATION_CHANGED`: Document classification updated
- `POLICY_UPDATED`: Access policy was modified
- `USER_ADDED`: New user was added to system
- `USER_REMOVED`: User was removed from system
- `RETENTION_TRIGGERED`: Document retention policy triggered

## Hash Chain Implementation

### Cryptographic Integrity
- Each event includes a SHA-256 hash of its contents
- Events are linked via `prev_hash` field
- Tampering detection through hash verification
- Immutable audit trail (WORM behavior)

### Hash Calculation
```sql
hash = SHA256(
  event_id + 
  timestamp + 
  actor_user_id + 
  action + 
  object_id + 
  object_type + 
  policy_decision + 
  reason + 
  prev_hash + 
  metadata
)
```

## Compliance Features

### Data Retention
- Configurable retention periods by event type
- Automatic archival of old events
- Legal hold support for extended retention
- Secure deletion when retention expires

### Privacy Protection
- PII redaction in audit logs
- Anonymization options for sensitive data
- Access controls on audit data
- Encryption at rest and in transit

### Regulatory Compliance
- GDPR: Right to be forgotten, data portability
- HIPAA: Audit requirements for PHI access
- SOX: Financial data access controls
- PCI DSS: Payment card data protection

## Query Examples

### Common Audit Queries
```sql
-- Who accessed what in the last 24 hours
SELECT actor_user_id, action, object_id, ts, policy_decision
FROM audit_events 
WHERE ts > NOW() - INTERVAL '24 hours'
ORDER BY ts DESC;

-- Which policies denied results
SELECT policy_decision, reason, COUNT(*) as denial_count
FROM audit_events 
WHERE policy_decision = 'DENY'
GROUP BY policy_decision, reason;

-- Label change history for document
SELECT ts, actor_user_id, action, reason, metadata
FROM audit_events 
WHERE object_id = 'doc-uuid' 
  AND action = 'CLASSIFICATION_CHANGED'
ORDER BY ts DESC;

-- Step-up authentication events
SELECT actor_user_id, ts, reason
FROM audit_events 
WHERE action IN ('STEP_UP_REQUIRED', 'STEP_UP_OK')
ORDER BY ts DESC;
```

## Monitoring and Alerting

### Real-time Monitoring
- Failed authentication attempts
- Policy violations
- Unusual access patterns
- System performance metrics

### Alert Conditions
- Multiple failed access attempts
- Access to highly sensitive data
- Cross-tenant access attempts
- Unusual query patterns
- System errors or failures

### Reporting
- Daily/weekly/monthly audit reports
- Compliance dashboards
- Executive summaries
- Detailed forensic reports

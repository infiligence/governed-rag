# Security Policy

## Overview

The Governed RAG platform implements multiple layers of security to ensure data protection, access control, and compliance with regulatory requirements.

## Security Architecture

### Zero-Trust Access Control

All access decisions are policy-driven and evaluated at runtime:

- **Policy Decision Point (PDP)**: OPA-based policy engine
- **Real-time evaluation**: Every document access is authorized
- **No implicit trust**: Users and services must prove authorization

### Multi-Layer Defense

```
┌─────────────────────────────────────────┐
│  1. Authentication (JWT)                │
├─────────────────────────────────────────┤
│  2. Authorization (OPA Policies)        │
├─────────────────────────────────────────┤
│  3. Classification (Automatic Labeling) │
├─────────────────────────────────────────┤
│  4. Redaction (PII/PHI Masking)         │
├─────────────────────────────────────────┤
│  5. Audit Trail (Hash-Chained Ledger)   │
└─────────────────────────────────────────┘
```

## Access Control Models

### Role-Based Access Control (RBAC)

Groups determine baseline permissions:
- `eng` - Engineering group (Internal access)
- `legal` - Legal group (Regulated access)
- `hr` - Human Resources (Confidential access)
- `finance` - Finance group (Confidential access)

### Attribute-Based Access Control (ABAC)

User attributes provide fine-grained control:
- `clearance`: public | internal | confidential | regulated
- `mfa_satisfied`: boolean (step-up authentication)
- `allow_export`: boolean (export permissions)

### Document Classification

All documents are automatically classified:
- **Public**: Accessible to all authenticated users
- **Internal**: Requires group membership
- **Confidential**: Requires clearance level + optional MFA
- **Regulated**: Requires highest clearance + MFA

## Policy Enforcement

### OPA Rego Policies

Located in `tech/policies/opa/access.rego`:

```rego
# Example: Confidential access requires both clearance and MFA
allow {
    input.action == "read"
    input.resource.label == "Confidential"
    input.subject.attrs.clearance == "confidential"
    input.subject.attrs.mfa_satisfied == true
}
```

### Policy Testing

Test policies before deployment:
```bash
# Test PDP service
curl -X POST http://localhost:3001/test

# Verify policy decisions
curl -X POST http://localhost:3001/authorize \
  -H 'Content-Type: application/json' \
  -d '{
    "subject": {"user_id": "test@example.com", "groups": ["eng"], "attrs": {"clearance": "internal"}},
    "resource": {"label": "Internal", "source": "dropbox", "owner": "alice@dash", "tenant": "dash"},
    "action": "read"
  }'
```

## Data Protection

### Redaction Levels

- **Minimal**: Critical PII only (SSN, credit cards)
- **Standard**: Critical + High sensitivity (emails, phones, DOB)
- **Strict**: All PII patterns

### Classification-Based Redaction

| Classification | Default Redaction | Patterns Applied |
|---------------|-------------------|------------------|
| Public | Minimal | Critical only |
| Internal | Standard | Critical + High |
| Confidential | Standard | Critical + High + Medium |
| Regulated | Strict | All patterns |

### PII Patterns

Supported PII detection patterns:
- Social Security Numbers (SSN)
- Email addresses
- Phone numbers
- Credit card numbers (PAN)
- IP addresses
- Physical addresses
- Dates of birth

## Audit Trail

### Hash-Chained Ledger

Every access event is recorded in a tamper-evident audit trail:

```sql
CREATE TABLE audit_events (
    event_id UUID PRIMARY KEY,
    ts TIMESTAMP,
    actor_user_id VARCHAR(255),
    action VARCHAR(50),
    policy_decision VARCHAR(20),
    hash VARCHAR(64),          -- SHA-256 hash
    prev_hash VARCHAR(64),     -- Previous event hash
    metadata JSONB
);
```

### WORM (Write-Once-Read-Many)

Audit events cannot be modified or deleted:
- Database triggers prevent UPDATE/DELETE operations
- Each event links to previous event via hash chain
- Integrity verification available via API

### Verification

```bash
# Verify hash chain integrity
curl -X POST http://localhost:3004/lineage/verify \
  -H 'Content-Type: application/json' \
  -d '{"user_id": "alice@dash"}'
```

## Compliance Features

### GDPR Compliance

- **Right to Access**: Audit trail provides complete access history
- **Right to Erasure**: Retention policies enforce data deletion
- **Data Portability**: Export APIs (with proper authorization)
- **Privacy by Design**: Classification and redaction by default

### HIPAA Compliance

- **PHI Protection**: Automatic redaction of health information
- **Access Controls**: Regulated classification for PHI
- **Audit Requirements**: Complete audit trail
- **Encryption**: At rest (PostgreSQL) and in transit (TLS)

### SOX Compliance

- **Financial Data Protection**: Confidential/Regulated classification
- **Audit Trail**: Immutable access logs
- **Segregation of Duties**: Group-based access control

## Security Best Practices

### For Development

1. **Never commit secrets** to version control
2. **Use environment variables** for configuration
3. **Test policies** before deploying
4. **Review audit logs** regularly
5. **Update dependencies** to patch vulnerabilities

### For Production

1. **Use strong JWT secrets** (not the demo default)
2. **Enable TLS/SSL** for all services
3. **Implement rate limiting** on API endpoints
4. **Set up monitoring** and alerting
5. **Regular security audits** of policies and access patterns
6. **Backup database** including audit trail
7. **Use secrets management** (AWS Secrets Manager, HashiCorp Vault)

### Environment Variables

Required for production:

```bash
# Strong random secret (256-bit)
export JWT_SECRET="your-production-secret-here"

# Database with encryption at rest
export POSTGRES_URL="postgres://user:pass@prod-db:5432/govrag"

# Redis with TLS
export REDIS_URL="rediss://prod-redis:6379"

# OPA with external bundle service
export OPA_URL="https://opa-prod:8181"
```

## Step-Up Authentication

For sensitive content access:

1. **Initial Authentication**: JWT token
2. **Sensitive Content Detected**: System requires MFA
3. **MFA Challenge**: User provides second factor
4. **Time-Limited Session**: 5-minute MFA window
5. **Re-authentication**: Required for new sensitive access

## Incident Response

### Security Event Detection

Monitor for:
- Repeated access denials (potential attack)
- Export attempts on regulated data
- Policy decision failures
- Unusual access patterns

### Response Procedures

1. **Detection**: Alert triggered by monitoring
2. **Investigation**: Review audit trail
3. **Containment**: Disable user/service if needed
4. **Remediation**: Update policies, patch vulnerabilities
5. **Documentation**: Record in security log

## Vulnerability Reporting

If you discover a security vulnerability:

1. **Do NOT** open a public issue
2. Email: security@example.com (replace with actual contact)
3. Include:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if known)

## Security Updates

- **Critical**: Deployed within 24 hours
- **High**: Deployed within 1 week
- **Medium**: Deployed within 1 month
- **Low**: Scheduled for next release

## Threat Model

### Threats Mitigated

✅ Unauthorized data access
✅ PII/PHI leakage
✅ Policy bypass attempts
✅ Audit trail tampering
✅ Privilege escalation
✅ Cross-tenant data access

### Known Limitations

⚠️ This is a demonstration system
⚠️ Demo uses weak JWT secret (must change for production)
⚠️ No rate limiting implemented
⚠️ No DDoS protection
⚠️ Embeddings are placeholder (not production-quality)

## Security Checklist for Production

- [ ] Change all default credentials
- [ ] Use strong JWT secret (256-bit random)
- [ ] Enable TLS/SSL on all services
- [ ] Implement rate limiting
- [ ] Set up intrusion detection
- [ ] Configure firewall rules
- [ ] Enable database encryption at rest
- [ ] Implement backup strategy
- [ ] Set up monitoring and alerting
- [ ] Conduct security audit
- [ ] Penetration testing
- [ ] Document incident response plan
- [ ] Train team on security procedures

## References

- [OPA Best Practices](https://www.openpolicyagent.org/docs/latest/security/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [CIS Controls](https://www.cisecurity.org/controls/)


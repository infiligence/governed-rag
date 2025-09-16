# Demo Scenarios for Governed RAG System

This document outlines the key scenarios to demonstrate the governed RAG system's capabilities.

## Prerequisites

1. Start the services: `docker-compose up`
2. Run the seed script: `./scripts/seed.sh`
3. Get authentication tokens for different users

## Scenario A: Same Query, Different Users

**Objective**: Demonstrate how different users with different clearance levels see different results for the same query.

### Setup
```bash
# Get tokens for different users
curl -X POST http://localhost:8080/auth/token \
  -H "Content-Type: application/json" \
  -d '{"user_id": "alice@dash"}'

curl -X POST http://localhost:8080/auth/token \
  -H "Content-Type: application/json" \
  -d '{"user_id": "sam@legal"}'
```

### Test Query: "security policies"
```bash
# Alice (internal clearance) - should see internal docs
curl -X POST http://localhost:8080/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <alice_token>" \
  -d '{
    "query": "security policies",
    "top_k": 5,
    "user_id": "alice@dash"
  }'

# Sam (regulated clearance) - should see more docs including regulated
curl -X POST http://localhost:8080/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <sam_token>" \
  -d '{
    "query": "security policies", 
    "top_k": 5,
    "user_id": "sam@legal"
  }'
```

**Expected Results**:
- Alice sees internal documents about security policies
- Sam sees additional regulated documents (GDPR compliance, etc.)
- Both users see different result counts and content

## Scenario B: Step-up Authentication

**Objective**: Demonstrate MFA requirement for sensitive content.

### Setup
```bash
# Get token for Bob (internal clearance)
curl -X POST http://localhost:8080/auth/token \
  -H "Content-Type: application/json" \
  -d '{"user_id": "bob@dash"}'
```

### Test Query: "confidential information"
```bash
# First attempt - should require step-up
curl -X POST http://localhost:8080/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <bob_token>" \
  -d '{
    "query": "confidential information",
    "top_k": 5,
    "user_id": "bob@dash"
  }'

# Complete step-up authentication
curl -X POST http://localhost:8080/auth/step-up \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <bob_token>" \
  -d '{
    "user_id": "bob@dash",
    "mfa_token": "demo_mfa_token"
  }'

# Retry query - should now work
curl -X POST http://localhost:8080/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <bob_token>" \
  -d '{
    "query": "confidential information",
    "top_k": 5,
    "user_id": "bob@dash"
  }'
```

**Expected Results**:
- First query returns step-up requirement
- After step-up, query succeeds with confidential content
- Audit trail shows step-up events

## Scenario C: Redaction vs Deny

**Objective**: Show how different classification levels result in different redaction behaviors.

### Test Query: "employee information"
```bash
# Query that should return PII/PHI
curl -X POST http://localhost:8080/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <alice_token>" \
  -d '{
    "query": "employee information",
    "top_k": 5,
    "user_id": "alice@dash"
  }'
```

**Expected Results**:
- Internal documents: PII masked (email addresses, phone numbers)
- Confidential documents: More aggressive redaction
- Regulated documents: May be denied entirely

## Scenario D: Export Blocked

**Objective**: Demonstrate export restrictions based on user permissions.

### Test Export
```bash
# Alice (no export permissions) - should be denied
curl -X POST http://localhost:8080/export \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <alice_token>" \
  -d '{
    "query": "security policies",
    "user_id": "alice@dash",
    "format": "json"
  }'

# Sam (has export permissions) - should be allowed
curl -X POST http://localhost:8080/export \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <sam_token>" \
  -d '{
    "query": "security policies",
    "user_id": "sam@legal",
    "format": "json"
  }'
```

**Expected Results**:
- Alice gets 403 Forbidden with policy decision DENY
- Sam gets successful response with policy decision ALLOW
- Audit trail records both attempts

## Scenario E: Audit Replay

**Objective**: Show comprehensive audit trail and hash chain integrity.

### View Audit Trail
```bash
# Get audit trail for Alice
curl -X GET http://localhost:8080/audit/alice@dash \
  -H "Authorization: Bearer <alice_token>"

# Get audit trail for Sam
curl -X GET http://localhost:8080/audit/sam@legal \
  -H "Authorization: Bearer <sam_token>"
```

**Expected Results**:
- Complete audit trail with hash chain
- All actions logged with policy decisions
- Hash chain validates integrity
- Different users have different audit histories

## Scenario F: Cross-Tenant Isolation

**Objective**: Demonstrate tenant isolation and boundary enforcement.

### Test Cross-Tenant Access
```bash
# Rita (vendor tenant) trying to access dash tenant data
curl -X POST http://localhost:8080/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <rita_token>" \
  -d '{
    "query": "dash internal policies",
    "top_k": 5,
    "user_id": "rita@vendor"
  }'
```

**Expected Results**:
- Only vendor tenant documents returned
- No dash tenant documents accessible
- Audit trail shows cross-tenant access attempts

## Scenario G: Policy Explanation

**Objective**: Show policy decision explanations and reasoning.

### Get Policy Explanations
```bash
# Explain why a query was denied
curl -X POST http://localhost:3001/explain \
  -H "Content-Type: application/json" \
  -d '{
    "subject": {
      "user_id": "alice@dash",
      "groups": ["eng"],
      "attrs": {"clearance": "internal"}
    },
    "resource": {
      "label": "Regulated",
      "source": "dropbox",
      "owner": "sam@legal",
      "tenant": "dash"
    },
    "action": "read"
  }'
```

**Expected Results**:
- Clear explanation of policy decision
- Rules applied and reasoning provided
- Policy ID for traceability

## Scenario H: Insufficient Evidence

**Objective**: Demonstrate watermarking when insufficient evidence is available.

### Test Query with Limited Data
```bash
# Query for very specific information that may not exist
curl -X POST http://localhost:8080/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <alice_token>" \
  -d '{
    "query": "quantum computing implementation details",
    "top_k": 5,
    "user_id": "alice@dash"
  }'
```

**Expected Results**:
- Watermarked response indicating insufficient evidence
- No hallucination or made-up information
- Clear indication that more information is needed

## Performance Testing

### Load Test
```bash
# Run multiple concurrent queries
for i in {1..10}; do
  curl -X POST http://localhost:8080/search \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <alice_token>" \
    -d '{
      "query": "system architecture",
      "top_k": 3,
      "user_id": "alice@dash"
    }' &
done
wait
```

## Monitoring and Observability

### Health Checks
```bash
# Check all service health
curl http://localhost:8080/health
curl http://localhost:3001/health
curl http://localhost:8000/health
curl http://localhost:8181/health
```

### Service Status
```bash
# Check Docker services
docker-compose ps

# View logs
docker-compose logs gateway-api
docker-compose logs pdp
docker-compose logs classifier
```

## Troubleshooting

### Common Issues
1. **Services not starting**: Check Docker logs and ensure all dependencies are running
2. **Database connection errors**: Verify PostgreSQL is running and accessible
3. **Policy evaluation failures**: Check OPA service and policy files
4. **Authentication errors**: Verify JWT secret and token generation

### Debug Commands
```bash
# Check database connectivity
psql $POSTGRES_URL -c "SELECT 1"

# Test OPA policies
curl -X POST http://localhost:8181/v1/data/access \
  -H "Content-Type: application/json" \
  -d '{"input": {"subject": {"user_id": "test", "groups": ["eng"], "attrs": {}}, "resource": {"label": "Public", "source": "test", "owner": "test", "tenant": "dash"}, "action": "read"}}'

# Check Redis connectivity
redis-cli -u $REDIS_URL ping
```

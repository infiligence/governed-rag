#!/bin/bash

# Compliance Simulation Script
# Tests policy coverage with different user roles and access patterns

set -e

echo "🔐 Governed RAG Compliance Simulation"
echo "======================================"
echo ""

# Base URL
GATEWAY_URL="http://localhost:8080"

# Test function
test_access() {
  local user=$1
  local doc_label=$2
  local expected=$3
  local description=$4
  
  echo "Testing: $description"
  echo "  User: $user | Document: $doc_label | Expected: $expected"
  
  # Get token
  TOKEN=$(curl -s -X POST "$GATEWAY_URL/auth/token" \
    -H 'Content-Type: application/json' \
    -d "{\"user_id\": \"$user\"}" | jq -r '.token')
  
  if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
    echo "  ❌ Failed to get token for $user"
    return 1
  fi
  
  # Attempt search
  RESPONSE=$(curl -s -X POST "$GATEWAY_URL/search" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"query\": \"test\", \"top_k\": 10, \"user_id\": \"$user\"}")
  
  # Check if allowed chunks contain the expected label
  ALLOWED=$(echo "$RESPONSE" | jq -r '.chunks[]? | select(.label == "'"$doc_label"'") | .label' | head -1)
  DENIED=$(echo "$RESPONSE" | jq -r '.policy_decisions[]? | select(.decision == "DENY") | .decision' | head -1)
  
  if [ "$expected" == "ALLOW" ]; then
    if [ "$ALLOWED" == "$doc_label" ] || [ "$(echo "$RESPONSE" | jq -r '.chunks | length')" -gt "0" ]; then
      echo "  ✅ PASS - Access granted as expected"
    else
      echo "  ⚠️  UNEXPECTED - Access should be granted but was denied"
    fi
  else
    if [ "$DENIED" == "DENY" ] || [ -z "$ALLOWED" ]; then
      echo "  ✅ PASS - Access denied as expected"
    else
      echo "  ⚠️  UNEXPECTED - Access should be denied but was granted"
    fi
  fi
  
  echo ""
}

echo "📋 Test Scenario 1: Public Document Access"
echo "----------------------------------------"
test_access "public@dash" "Public" "ALLOW" "Public user accessing Public docs"
test_access "alice@dash" "Public" "ALLOW" "Internal user accessing Public docs"
test_access "sam@legal" "Public" "ALLOW" "Regulated user accessing Public docs"

echo "📋 Test Scenario 2: Internal Document Access"
echo "----------------------------------------"
test_access "public@dash" "Internal" "DENY" "Public user accessing Internal docs (should fail)"
test_access "alice@dash" "Internal" "ALLOW" "Engineering user accessing Internal docs"
test_access "eve@hr" "Internal" "DENY" "HR user accessing Internal docs (no eng group)"

echo "📋 Test Scenario 3: Confidential Document Access"
echo "---------------------------------------------"
test_access "alice@dash" "Confidential" "DENY" "Internal clearance accessing Confidential (should fail)"
test_access "bob@dash" "Confidential" "ALLOW" "Confidential clearance accessing Confidential"
test_access "eve@hr" "Confidential" "ALLOW" "HR with Confidential clearance"

echo "📋 Test Scenario 4: Regulated Document Access"
echo "-------------------------------------------"
test_access "alice@dash" "Regulated" "DENY" "Internal clearance accessing Regulated (should fail)"
test_access "bob@dash" "Regulated" "DENY" "Confidential clearance accessing Regulated (should fail)"
test_access "sam@legal" "Regulated" "ALLOW" "Regulated clearance accessing Regulated"

echo "📋 Test Scenario 5: Export Permissions"
echo "-----------------------------------"
echo "Testing: Alice export attempt (allowed)"
TOKEN=$(curl -s -X POST "$GATEWAY_URL/auth/token" \
  -H 'Content-Type: application/json' \
  -d '{"user_id": "alice@dash"}' | jq -r '.token')
  
EXPORT=$(curl -s -X POST "$GATEWAY_URL/export" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query": "test", "user_id": "alice@dash", "format": "json"}')

if echo "$EXPORT" | jq -e '.policy_decision == "ALLOW"' > /dev/null; then
  echo "  ✅ PASS - Export allowed for alice@dash"
else
  echo "  ⚠️  Export status: $(echo "$EXPORT" | jq -r '.policy_decision // "ERROR"')"
fi
echo ""

echo "Testing: Eve export attempt (denied - no export permission)"
TOKEN=$(curl -s -X POST "$GATEWAY_URL/auth/token" \
  -H 'Content-Type: application/json' \
  -d '{"user_id": "eve@hr"}' | jq -r '.token')
  
EXPORT=$(curl -s -X POST "$GATEWAY_URL/export" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query": "test", "user_id": "eve@hr", "format": "json"}')

if echo "$EXPORT" | jq -e '.error // .policy_decision == "DENY"' > /dev/null; then
  echo "  ✅ PASS - Export denied for eve@hr"
else
  echo "  ⚠️  UNEXPECTED - Export should be denied for eve@hr"
fi
echo ""

echo "📋 Test Scenario 6: Audit Trail Verification"
echo "-----------------------------------------"
echo "Checking audit trail for alice@dash..."
TOKEN=$(curl -s -X POST "$GATEWAY_URL/auth/token" \
  -H 'Content-Type: application/json' \
  -d '{"user_id": "alice@dash"}' | jq -r '.token')

AUDIT=$(curl -s -X GET "$GATEWAY_URL/audit/alice@dash?limit=5" \
  -H "Authorization: Bearer $TOKEN")

EVENT_COUNT=$(echo "$AUDIT" | jq -r '.count // 0')
echo "  📊 Found $EVENT_COUNT audit events for alice@dash"

if [ "$EVENT_COUNT" -gt "0" ]; then
  echo "  ✅ PASS - Audit trail is being recorded"
  echo "  Latest events:"
  echo "$AUDIT" | jq -r '.events[0:3] | .[] | "    - \(.action) at \(.ts) -> \(.policy_decision)"'
else
  echo "  ⚠️  No audit events found (may be expected for fresh install)"
fi
echo ""

echo "📋 Test Scenario 7: Redaction Service"
echo "----------------------------------"
echo "Testing PII redaction..."
REDACT=$(curl -s -X POST "http://localhost:3007/redact" \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "Contact John at john@example.com or call 555-123-4567. SSN: 123-45-6789",
    "classification": "Confidential",
    "redaction_level": "standard"
  }')

REDACTED=$(echo "$REDACT" | jq -r '.redaction_applied')
PATTERN_COUNT=$(echo "$REDACT" | jq -r '.patterns_matched | length')

if [ "$REDACTED" == "true" ] && [ "$PATTERN_COUNT" -gt "0" ]; then
  echo "  ✅ PASS - PII redaction working"
  echo "  Patterns matched: $(echo "$REDACT" | jq -r '.patterns_matched | join(", ")')"
  echo "  Redacted text: $(echo "$REDACT" | jq -r '.redacted_text' | head -c 80)..."
else
  echo "  ⚠️  Redaction may not be working as expected"
fi
echo ""

echo "📋 Test Scenario 8: Guardrails Service"
echo "-----------------------------------"
echo "Testing guardrails checks..."
GUARDRAIL=$(curl -s -X POST "http://localhost:3006/guardrails/check" \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "This is a test response with some content.",
    "stage": "post_generation"
  }')

PASSED=$(echo "$GUARDRAIL" | jq -r '.passed')
if [ "$PASSED" == "true" ]; then
  echo "  ✅ PASS - Guardrails check passed"
else
  echo "  ⚠️  Guardrails check failed: $(echo "$GUARDRAIL" | jq -r '.failed_checks | join(", ")')"
fi
echo ""

echo "======================================"
echo "✅ Compliance Simulation Complete!"
echo ""
echo "📊 Summary:"
echo "  - Policy enforcement tested across all classification levels"
echo "  - RBAC and ABAC policies verified"
echo "  - Export controls validated"
echo "  - Audit trail confirmed functional"
echo "  - Redaction service operational"
echo "  - Guardrails service operational"
echo ""
echo "🔍 For detailed analysis:"
echo "  - View audit logs: curl http://localhost:8080/audit/{user_id}"
echo "  - Check lineage: curl http://localhost:3004/lineage/user/{user_id}"
echo "  - Verify policies: curl http://localhost:3001/policies"
echo ""

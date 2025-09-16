-- Audit Query Examples for Governed RAG System

-- 1. Who queried what and why (last 24 hours)
SELECT 
    ae.actor_user_id,
    ae.action,
    ae.object_id,
    ae.object_type,
    ae.policy_decision,
    ae.reason,
    ae.ts,
    i.email,
    i.groups
FROM audit_events ae
LEFT JOIN identities i ON ae.actor_user_id = i.user_id
WHERE ae.ts > NOW() - INTERVAL '24 hours'
  AND ae.action IN ('QUERY_ISSUED', 'RESULT_RETURNED', 'DOCUMENT_ACCESSED')
ORDER BY ae.ts DESC;

-- 2. Which policies denied results
SELECT 
    ae.policy_decision,
    ae.reason,
    COUNT(*) as denial_count,
    COUNT(DISTINCT ae.actor_user_id) as unique_users,
    DATE_TRUNC('hour', ae.ts) as hour_bucket
FROM audit_events ae
WHERE ae.policy_decision = 'DENY'
  AND ae.ts > NOW() - INTERVAL '7 days'
GROUP BY ae.policy_decision, ae.reason, DATE_TRUNC('hour', ae.ts)
ORDER BY hour_bucket DESC, denial_count DESC;

-- 3. Label change history for specific document
SELECT 
    ae.ts,
    ae.actor_user_id,
    ae.action,
    ae.reason,
    ae.metadata->>'old_label' as old_label,
    ae.metadata->>'new_label' as new_label,
    i.email
FROM audit_events ae
LEFT JOIN identities i ON ae.actor_user_id = i.user_id
WHERE ae.object_id = $1  -- Replace with actual doc_id
  AND ae.action = 'CLASSIFICATION_CHANGED'
ORDER BY ae.ts DESC;

-- 4. Step-up authentication events
SELECT 
    ae.actor_user_id,
    ae.ts,
    ae.reason,
    ae.metadata->>'required_level' as required_level,
    i.email,
    i.attributes->>'clearance' as clearance_level
FROM audit_events ae
LEFT JOIN identities i ON ae.actor_user_id = i.user_id
WHERE ae.action IN ('STEP_UP_REQUIRED', 'STEP_UP_OK')
  AND ae.ts > NOW() - INTERVAL '30 days'
ORDER BY ae.ts DESC;

-- 5. Cross-tenant access attempts (security monitoring)
SELECT 
    ae.actor_user_id,
    ae.ts,
    ae.reason,
    ae.metadata->>'attempted_tenant' as attempted_tenant,
    ae.metadata->>'user_tenant' as user_tenant,
    i.email
FROM audit_events ae
LEFT JOIN identities i ON ae.actor_user_id = i.user_id
WHERE ae.action = 'CROSS_TENANT_DENIED'
  AND ae.ts > NOW() - INTERVAL '7 days'
ORDER BY ae.ts DESC;

-- 6. Export attempts and denials
SELECT 
    ae.actor_user_id,
    ae.ts,
    ae.policy_decision,
    ae.reason,
    ae.metadata->>'export_type' as export_type,
    ae.metadata->>'document_count' as document_count,
    i.email
FROM audit_events ae
LEFT JOIN identities i ON ae.actor_user_id = i.user_id
WHERE ae.action IN ('EXPORT_ATTEMPTED', 'EXPORT_DENIED', 'EXPORT_GRANTED')
  AND ae.ts > NOW() - INTERVAL '30 days'
ORDER BY ae.ts DESC;

-- 7. Redaction applied events
SELECT 
    ae.actor_user_id,
    ae.ts,
    ae.object_id,
    ae.metadata->>'redaction_type' as redaction_type,
    ae.metadata->>'patterns_matched' as patterns_matched,
    ae.metadata->>'chunks_processed' as chunks_processed,
    i.email
FROM audit_events ae
LEFT JOIN identities i ON ae.actor_user_id = i.user_id
WHERE ae.action = 'REDACTION_APPLIED'
  AND ae.ts > NOW() - INTERVAL '7 days'
ORDER BY ae.ts DESC;

-- 8. User activity summary (last 30 days)
SELECT 
    ae.actor_user_id,
    i.email,
    i.groups,
    COUNT(*) as total_events,
    COUNT(CASE WHEN ae.policy_decision = 'ALLOW' THEN 1 END) as allowed_actions,
    COUNT(CASE WHEN ae.policy_decision = 'DENY' THEN 1 END) as denied_actions,
    COUNT(CASE WHEN ae.action = 'QUERY_ISSUED' THEN 1 END) as queries_issued,
    COUNT(CASE WHEN ae.action = 'STEP_UP_REQUIRED' THEN 1 END) as step_up_required,
    MAX(ae.ts) as last_activity
FROM audit_events ae
LEFT JOIN identities i ON ae.actor_user_id = i.user_id
WHERE ae.ts > NOW() - INTERVAL '30 days'
GROUP BY ae.actor_user_id, i.email, i.groups
ORDER BY total_events DESC;

-- 9. Policy effectiveness analysis
SELECT 
    ae.reason as policy_rule,
    COUNT(*) as total_decisions,
    COUNT(CASE WHEN ae.policy_decision = 'ALLOW' THEN 1 END) as allowed,
    COUNT(CASE WHEN ae.policy_decision = 'DENY' THEN 1 END) as denied,
    COUNT(CASE WHEN ae.policy_decision = 'STEP_UP_REQUIRED' THEN 1 END) as step_up,
    ROUND(
        COUNT(CASE WHEN ae.policy_decision = 'DENY' THEN 1 END) * 100.0 / COUNT(*), 
        2
    ) as denial_rate_percent
FROM audit_events ae
WHERE ae.ts > NOW() - INTERVAL '7 days'
  AND ae.reason IS NOT NULL
GROUP BY ae.reason
ORDER BY total_decisions DESC;

-- 10. Audit trail integrity check (hash chain validation)
WITH hash_chain AS (
    SELECT 
        ae.event_id,
        ae.ts,
        ae.actor_user_id,
        ae.hash,
        ae.prev_hash,
        LAG(ae.hash) OVER (
            PARTITION BY ae.actor_user_id 
            ORDER BY ae.ts
        ) as expected_prev_hash
    FROM audit_events ae
    WHERE ae.ts > NOW() - INTERVAL '7 days'
)
SELECT 
    event_id,
    ts,
    actor_user_id,
    CASE 
        WHEN prev_hash = expected_prev_hash THEN 'VALID'
        WHEN prev_hash IS NULL AND expected_prev_hash IS NULL THEN 'VALID'
        ELSE 'INVALID'
    END as chain_status
FROM hash_chain
WHERE prev_hash != expected_prev_hash 
   OR (prev_hash IS NULL AND expected_prev_hash IS NOT NULL)
ORDER BY ts DESC;

-- 11. Document access patterns
SELECT 
    ae.object_id,
    d.title,
    d.source,
    COUNT(*) as access_count,
    COUNT(DISTINCT ae.actor_user_id) as unique_users,
    MAX(ae.ts) as last_accessed,
    dl.label as classification
FROM audit_events ae
LEFT JOIN documents d ON ae.object_id = d.doc_id::text
LEFT JOIN document_labels dl ON d.doc_id = dl.doc_id
WHERE ae.action = 'DOCUMENT_ACCESSED'
  AND ae.ts > NOW() - INTERVAL '30 days'
GROUP BY ae.object_id, d.title, d.source, dl.label
ORDER BY access_count DESC
LIMIT 20;

-- 12. Failed authentication and suspicious activity
SELECT 
    ae.actor_user_id,
    ae.ts,
    ae.action,
    ae.reason,
    ae.metadata->>'ip_address' as ip_address,
    ae.metadata->>'user_agent' as user_agent,
    i.email
FROM audit_events ae
LEFT JOIN identities i ON ae.actor_user_id = i.user_id
WHERE ae.action IN ('AUTH_FAILED', 'SUSPICIOUS_ACTIVITY', 'BRUTE_FORCE_DETECTED')
  AND ae.ts > NOW() - INTERVAL '24 hours'
ORDER BY ae.ts DESC;

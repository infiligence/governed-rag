#!/bin/bash

# Seed script for Governed RAG Demo
set -e

echo "🌱 Seeding Governed RAG Database..."
echo "======================================"

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check if PostgreSQL is ready
until docker exec $(docker ps -qf "name=postgres") pg_isready -U postgres > /dev/null 2>&1; do
  echo "⏳ Waiting for PostgreSQL..."
  sleep 2
done
echo "✅ PostgreSQL is ready"

# Seed identities (users)
echo ""
echo "👥 Seeding user identities..."
docker exec -i $(docker ps -qf "name=postgres") psql -U postgres -d govrag << 'EOF'
-- Insert demo users with different clearance levels

-- Alice: Engineering, Internal clearance
INSERT INTO identities (user_id, email, groups, mfa_level, attributes)
VALUES (
  'alice@dash',
  'alice@dashcorp.com',
  ARRAY['eng'],
  1,
  '{"clearance": "internal", "mfa_satisfied": false, "allow_export": true}'::jsonb
)
ON CONFLICT (user_id) DO UPDATE
SET groups = EXCLUDED.groups,
    attributes = EXCLUDED.attributes;

-- Bob: Engineering, Confidential clearance
INSERT INTO identities (user_id, email, groups, mfa_level, attributes)
VALUES (
  'bob@dash',
  'bob@dashcorp.com',
  ARRAY['eng', 'security'],
  2,
  '{"clearance": "confidential", "mfa_satisfied": false, "allow_export": true}'::jsonb
)
ON CONFLICT (user_id) DO UPDATE
SET groups = EXCLUDED.groups,
    attributes = EXCLUDED.attributes;

-- Sam: Legal, Regulated clearance
INSERT INTO identities (user_id, email, groups, mfa_level, attributes)
VALUES (
  'sam@legal',
  'sam@dashcorp.com',
  ARRAY['legal', 'compliance'],
  2,
  '{"clearance": "regulated", "mfa_satisfied": false, "allow_export": true}'::jsonb
)
ON CONFLICT (user_id) DO UPDATE
SET groups = EXCLUDED.groups,
    attributes = EXCLUDED.attributes;

-- Eve: HR, Confidential clearance
INSERT INTO identities (user_id, email, groups, mfa_level, attributes)
VALUES (
  'eve@hr',
  'eve@dashcorp.com',
  ARRAY['hr'],
  1,
  '{"clearance": "confidential", "mfa_satisfied": false, "allow_export": false}'::jsonb
)
ON CONFLICT (user_id) DO UPDATE
SET groups = EXCLUDED.groups,
    attributes = EXCLUDED.attributes;

-- Public user: Limited clearance
INSERT INTO identities (user_id, email, groups, mfa_level, attributes)
VALUES (
  'public@dash',
  'public@dashcorp.com',
  ARRAY['public'],
  1,
  '{"clearance": "public", "mfa_satisfied": false, "allow_export": false}'::jsonb
)
ON CONFLICT (user_id) DO UPDATE
SET groups = EXCLUDED.groups,
    attributes = EXCLUDED.attributes;

EOF

echo "✅ Seeded 5 demo users"

# Seed sample documents
echo ""
echo "📄 Seeding sample documents..."
docker exec -i $(docker ps -qf "name=postgres") psql -U postgres -d govrag << 'EOF'
-- Insert sample documents with different classifications

-- Public document
INSERT INTO documents (doc_id, source, path, title, mime, owner_user_id, tenant)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'dropbox',
  '/public/company-handbook.pdf',
  'Company Handbook',
  'application/pdf',
  'alice@dash',
  'dash'
)
ON CONFLICT (doc_id) DO NOTHING;

INSERT INTO document_labels (doc_id, label, confidence, reason)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Public',
  0.95,
  'Public company information'
)
ON CONFLICT (doc_id, created_at) DO NOTHING;

INSERT INTO chunks (chunk_id, doc_id, ord, text, label)
VALUES (
  '11111111-1111-1111-1111-111111111112',
  '11111111-1111-1111-1111-111111111111',
  0,
  'Welcome to DashCorp! Our company values include transparency, innovation, and collaboration. We are committed to creating an inclusive workplace where everyone can thrive.',
  'Public'
)
ON CONFLICT (chunk_id) DO NOTHING;

-- Internal document
INSERT INTO documents (doc_id, source, path, title, mime, owner_user_id, tenant)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'confluence',
  '/engineering/architecture-docs.md',
  'System Architecture Documentation',
  'text/markdown',
  'alice@dash',
  'dash'
)
ON CONFLICT (doc_id) DO NOTHING;

INSERT INTO document_labels (doc_id, label, confidence, reason)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'Internal',
  0.90,
  'Internal engineering documentation'
)
ON CONFLICT (doc_id, created_at) DO NOTHING;

INSERT INTO chunks (chunk_id, doc_id, ord, text, label)
VALUES (
  '22222222-2222-2222-2222-222222222223',
  '22222222-2222-2222-2222-222222222222',
  0,
  'The system architecture consists of microservices including gateway-api, classifier, retriever, and PDP. All services communicate via REST APIs and are deployed using Docker containers.',
  'Internal'
)
ON CONFLICT (chunk_id) DO NOTHING;

-- Confidential document
INSERT INTO documents (doc_id, source, path, title, mime, owner_user_id, tenant)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'jira',
  '/security/security-audit-2024.pdf',
  'Security Audit Report 2024',
  'application/pdf',
  'bob@dash',
  'dash'
)
ON CONFLICT (doc_id) DO NOTHING;

INSERT INTO document_labels (doc_id, label, confidence, reason)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'Confidential',
  0.92,
  'Security audit contains sensitive information'
)
ON CONFLICT (doc_id, created_at) DO NOTHING;

INSERT INTO chunks (chunk_id, doc_id, ord, text, label)
VALUES (
  '33333333-3333-3333-3333-333333333334',
  '33333333-3333-3333-3333-333333333333',
  0,
  'Security audit identified several vulnerabilities in the authentication system. Immediate action required to patch XSS vulnerability in admin panel. Contact: bob@dashcorp.com',
  'Confidential'
)
ON CONFLICT (chunk_id) DO NOTHING;

-- Regulated document (PHI)
INSERT INTO documents (doc_id, source, path, title, mime, owner_user_id, tenant)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  'dropbox',
  '/legal/employee-health-records.xlsx',
  'Employee Health Records',
  'application/vnd.ms-excel',
  'sam@legal',
  'dash'
)
ON CONFLICT (doc_id) DO NOTHING;

INSERT INTO document_labels (doc_id, label, confidence, reason)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  'Regulated',
  0.98,
  'Contains PHI - Protected Health Information'
)
ON CONFLICT (doc_id, created_at) DO NOTHING;

INSERT INTO chunks (chunk_id, doc_id, ord, text, label)
VALUES (
  '44444444-4444-4444-4444-444444444445',
  '44444444-4444-4444-4444-444444444444',
  0,
  'Employee health insurance claims for 2024. John Doe (SSN: 123-45-6789) submitted claim for medical procedure on 03/15/2024. Diagnosis code: ICD-10 E11.9. Contact: 555-123-4567',
  'Regulated'
)
ON CONFLICT (chunk_id) DO NOTHING;

EOF

echo "✅ Seeded 4 sample documents with chunks"

# Seed retention policies
echo ""
echo "📋 Seeding retention policies..."
docker exec -i $(docker ps -qf "name=postgres") psql -U postgres -d govrag << 'EOF'
-- Insert retention policies

INSERT INTO retention_policy (label, source, days_to_live, legal_hold)
VALUES
  ('Public', 'dropbox', 365, false),
  ('Internal', 'dropbox', 730, false),
  ('Confidential', 'dropbox', 2555, false),
  ('Regulated', 'dropbox', 2555, true)
ON CONFLICT (label, source) DO UPDATE
SET days_to_live = EXCLUDED.days_to_live,
    legal_hold = EXCLUDED.legal_hold;

EOF

echo "✅ Seeded retention policies"

# Summary
echo ""
echo "======================================"
echo "✅ Database seeding complete!"
echo ""
echo "👥 Created users:"
echo "   - alice@dash (Internal clearance, eng group)"
echo "   - bob@dash (Confidential clearance, eng+security groups)"
echo "   - sam@legal (Regulated clearance, legal+compliance groups)"
echo "   - eve@hr (Confidential clearance, hr group)"
echo "   - public@dash (Public clearance, public group)"
echo ""
echo "📄 Created documents:"
echo "   - Company Handbook (Public)"
echo "   - Architecture Docs (Internal)"
echo "   - Security Audit (Confidential)"
echo "   - Health Records (Regulated)"
echo ""
echo "🚀 Ready to run demo scenarios!"
echo "   Run: make demo"
echo ""

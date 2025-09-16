#!/bin/bash

# Seed script for Governed RAG Demo
# This script loads initial data into the system

set -e

echo "🌱 Starting seed process..."

# Configuration
POSTGRES_URL=${POSTGRES_URL:-"postgres://postgres:postgres@localhost:5432/govrag"}
SEED_DIR="./seed"

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
until psql "$POSTGRES_URL" -c "SELECT 1" > /dev/null 2>&1; do
  echo "Database not ready, waiting..."
  sleep 2
done

echo "✅ Database is ready"

# Load SCIM users and groups
echo "👥 Loading SCIM users and groups..."
psql "$POSTGRES_URL" -c "
INSERT INTO identities (user_id, email, groups, mfa_level, attributes)
SELECT 
  user_id,
  email,
  groups,
  mfa_level,
  attributes::jsonb
FROM jsonb_to_recordset('$(cat $SEED_DIR/scim_seed.json | jq -c '.users')') AS x(
  user_id text,
  email text,
  groups text[],
  mfa_level int,
  attributes jsonb
)
ON CONFLICT (user_id) DO UPDATE SET
  email = EXCLUDED.email,
  groups = EXCLUDED.groups,
  mfa_level = EXCLUDED.mfa_level,
  attributes = EXCLUDED.attributes;
"

echo "✅ SCIM data loaded"

# Set up retention policies
echo "📋 Setting up retention policies..."
psql "$POSTGRES_URL" -c "
INSERT INTO retention_policy (label, source, days_to_live, legal_hold)
VALUES 
  ('Public', 'dropbox', 365, false),
  ('Internal', 'dropbox', 1095, false),
  ('Confidential', 'dropbox', 2555, false),
  ('Regulated', 'dropbox', 2555, true),
  ('Public', 'dash_tickets', 90, false),
  ('Internal', 'dash_tickets', 365, false),
  ('Confidential', 'dash_tickets', 1095, false),
  ('Regulated', 'dash_tickets', 2555, true),
  ('Public', 'third_party_notes', 180, false),
  ('Internal', 'third_party_notes', 365, false),
  ('Confidential', 'third_party_notes', 1095, false),
  ('Regulated', 'third_party_notes', 2555, true)
ON CONFLICT (label, source) DO UPDATE SET
  days_to_live = EXCLUDED.days_to_live,
  legal_hold = EXCLUDED.legal_hold;
"

echo "✅ Retention policies configured"

# Create some sample permissions
echo "🔐 Setting up sample permissions..."
psql "$POSTGRES_URL" -c "
INSERT INTO permissions (subject_id, object_id, relation, attrs)
VALUES 
  ('alice@dash', (SELECT doc_id FROM documents WHERE title = 'System Architecture Overview'), 'owner', '{}'),
  ('bob@dash', (SELECT doc_id FROM documents WHERE title = 'Security Policy and Procedures'), 'owner', '{}'),
  ('sam@legal', (SELECT doc_id FROM documents WHERE title = 'GDPR Compliance Review'), 'owner', '{}'),
  ('rita@vendor', (SELECT doc_id FROM documents WHERE title = 'Service Level Agreement'), 'owner', '{}')
ON CONFLICT (subject_id, object_id, relation) DO NOTHING;
"

echo "✅ Permissions configured"

# Run the indexer to process documents
echo "📚 Processing documents with indexer..."
if command -v docker-compose &> /dev/null; then
  docker-compose run --rm indexer
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
  docker compose run --rm indexer
else
  echo "⚠️  Docker not available, skipping document indexing"
  echo "   You can run the indexer manually later with: docker-compose run --rm indexer"
fi

echo "✅ Document processing complete"

# Verify the setup
echo "🔍 Verifying setup..."
echo "Users:"
psql "$POSTGRES_URL" -c "SELECT user_id, email, groups, attributes->>'clearance' as clearance FROM identities;"

echo "Documents:"
psql "$POSTGRES_URL" -c "SELECT COUNT(*) as document_count FROM documents;"

echo "Chunks:"
psql "$POSTGRES_URL" -c "SELECT COUNT(*) as chunk_count FROM chunks;"

echo "Classifications:"
psql "$POSTGRES_URL" -c "SELECT label, COUNT(*) as count FROM document_labels GROUP BY label ORDER BY label;"

echo "🎉 Seed process completed successfully!"
echo ""
echo "Next steps:"
echo "1. Start the services: docker-compose up"
echo "2. Test the API: curl http://localhost:8080/health"
echo "3. Run demo scenarios: make demo"

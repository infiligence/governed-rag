-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Document classification labels
CREATE TYPE document_label AS ENUM ('Public', 'Internal', 'Confidential', 'Regulated');

-- User identities table
CREATE TABLE identities (
    user_id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    groups TEXT[] NOT NULL DEFAULT '{}',
    mfa_level INTEGER NOT NULL DEFAULT 1,
    attributes JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Documents table
CREATE TABLE documents (
    doc_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(100) NOT NULL,
    path VARCHAR(500) NOT NULL,
    title VARCHAR(255) NOT NULL,
    mime VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    owner_user_id VARCHAR(255) NOT NULL REFERENCES identities(user_id),
    tenant VARCHAR(100) NOT NULL
);

-- Document labels table (classification results)
CREATE TABLE document_labels (
    doc_id UUID NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    label document_label NOT NULL,
    confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (doc_id, created_at)
);

-- Document chunks with embeddings
CREATE TABLE chunks (
    chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id UUID NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    ord INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding vector(768),
    label document_label NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Permissions table for ABAC/RBAC hybrid
CREATE TABLE permissions (
    subject_id VARCHAR(255) NOT NULL,
    object_id UUID NOT NULL,
    relation VARCHAR(50) NOT NULL,
    attrs JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (subject_id, object_id, relation)
);

-- Audit events with hash chain
CREATE TABLE audit_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ts TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actor_user_id VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL,
    object_id UUID,
    object_type VARCHAR(50),
    policy_decision VARCHAR(20) NOT NULL,
    reason TEXT,
    hash VARCHAR(64) NOT NULL,
    prev_hash VARCHAR(64),
    metadata JSONB DEFAULT '{}'
);

-- Denied results tracking
CREATE TABLE denied_results (
    ts TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actor_user_id VARCHAR(255) NOT NULL,
    query TEXT NOT NULL,
    object_id UUID,
    label document_label NOT NULL,
    rule_id VARCHAR(100) NOT NULL
);

-- Retention policies
CREATE TABLE retention_policy (
    label document_label NOT NULL,
    source VARCHAR(100) NOT NULL,
    days_to_live INTEGER NOT NULL,
    legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (label, source)
);

-- Indexes for performance
CREATE INDEX idx_documents_owner ON documents(owner_user_id);
CREATE INDEX idx_documents_tenant ON documents(tenant);
CREATE INDEX idx_documents_source ON documents(source);
CREATE INDEX idx_chunks_doc_id ON chunks(doc_id);
CREATE INDEX idx_chunks_label ON chunks(label);
CREATE INDEX idx_audit_events_actor ON audit_events(actor_user_id);
CREATE INDEX idx_audit_events_ts ON audit_events(ts);
CREATE INDEX idx_audit_events_hash ON audit_events(hash);
CREATE INDEX idx_permissions_subject ON permissions(subject_id);
CREATE INDEX idx_permissions_object ON permissions(object_id);

-- Function to calculate hash for audit chain
CREATE OR REPLACE FUNCTION calculate_audit_hash(
    p_event_id UUID,
    p_ts TIMESTAMP WITH TIME ZONE,
    p_actor_user_id VARCHAR(255),
    p_action VARCHAR(50),
    p_object_id UUID,
    p_object_type VARCHAR(50),
    p_policy_decision VARCHAR(20),
    p_reason TEXT,
    p_prev_hash VARCHAR(64),
    p_metadata JSONB
) RETURNS VARCHAR(64) AS $$
BEGIN
    RETURN encode(digest(
        p_event_id::text || 
        p_ts::text || 
        p_actor_user_id || 
        p_action || 
        COALESCE(p_object_id::text, '') || 
        COALESCE(p_object_type, '') || 
        p_policy_decision || 
        COALESCE(p_reason, '') || 
        COALESCE(p_prev_hash, '') || 
        COALESCE(p_metadata::text, ''),
        'sha256'
    ), 'hex');
END;
$$ LANGUAGE plpgsql;

-- Trigger to prevent UPDATE/DELETE on audit_events (WORM behavior)
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Audit events cannot be modified or deleted (WORM behavior)';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_worm_protection
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- Trigger to automatically calculate hash for new audit events
CREATE OR REPLACE FUNCTION set_audit_hash()
RETURNS TRIGGER AS $$
DECLARE
    prev_hash_val VARCHAR(64);
BEGIN
    -- Get the previous hash from the most recent event
    SELECT hash INTO prev_hash_val 
    FROM audit_events 
    WHERE actor_user_id = NEW.actor_user_id 
    ORDER BY ts DESC 
    LIMIT 1;
    
    -- Calculate new hash
    NEW.hash := calculate_audit_hash(
        NEW.event_id,
        NEW.ts,
        NEW.actor_user_id,
        NEW.action,
        NEW.object_id,
        NEW.object_type,
        NEW.policy_decision,
        NEW.reason,
        prev_hash_val,
        NEW.metadata
    );
    
    NEW.prev_hash := prev_hash_val;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_audit_hash_trigger
    BEFORE INSERT ON audit_events
    FOR EACH ROW EXECUTE FUNCTION set_audit_hash();

-- Function to update document updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_identities_updated_at
    BEFORE UPDATE ON identities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
# PostgreSQL with pgvector Configuration

## Overview

This demo uses PostgreSQL with the pgvector extension for storing document embeddings and performing vector similarity searches.

## Installation

```bash
# Install pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
```

## Vector Operations

### Embedding Storage
- Embeddings are stored as `vector(768)` type
- Supports various embedding models (OpenAI, Sentence-BERT, etc.)
- Indexed using IVFFlat for efficient similarity search

### Similarity Search
```sql
-- Cosine similarity search
SELECT chunk_id, text, 1 - (embedding <=> query_embedding) as similarity
FROM chunks 
WHERE embedding <=> query_embedding < 0.8
ORDER BY embedding <=> query_embedding
LIMIT 10;
```

## BYOK/KMS Design Notes

### Key Management Strategy
1. **Per-Document Keys**: Each document gets a unique encryption key
2. **Key Hierarchy**: Master key → Document keys → Chunk keys
3. **Key Rotation**: Regular rotation of document keys for security

### Implementation Approach
```sql
-- Key management table (conceptual)
CREATE TABLE document_keys (
    doc_id UUID PRIMARY KEY,
    encrypted_key BYTEA NOT NULL,
    key_version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    rotated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Key Rotation Process
1. Generate new key for document
2. Re-encrypt all chunks with new key
3. Update document_keys table
4. Securely delete old key material
5. Update audit trail

### Cryptographic Erasure
When deleting documents under legal hold:
1. Mark document as tombstone
2. Rotate encryption key to random value
3. Log cryptographic erasure event
4. Maintain audit trail for compliance

## Performance Considerations

### Indexing Strategy
- IVFFlat index for vector similarity
- B-tree indexes on metadata fields
- Composite indexes for filtered searches

### Query Optimization
- Pre-filter by label/tenant before vector search
- Use LIMIT clauses to reduce result sets
- Cache frequently accessed embeddings

### Scaling Considerations
- Partition chunks table by tenant
- Use read replicas for search queries
- Implement connection pooling
- Consider vector quantization for large datasets

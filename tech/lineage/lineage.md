# Lineage Events (Scaffold)

Schema: { id, user, data_ref, stage, timestamp, hash_prev, hash_curr, evidence }

Emit from: gateway, retriever, redactor.

Storage: append-only (e.g., Postgres table + hash chain).


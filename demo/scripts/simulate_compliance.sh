#!/usr/bin/env bash
set -euo pipefail

ROLES=("employee" "contractor" "guest" "compliance_officer")

for r in "${ROLES[@]}"; do
  echo "== Probing as role: $r =="
  # TODO: replace with actual gateway call
  curl -sS http://localhost:8080/search \
    -H "Authorization: Bearer <token-for-$r>" \
    -d '{"query":"sensitive report","user_role":"'"$r"'"}' || true
done


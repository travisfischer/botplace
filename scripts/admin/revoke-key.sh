#!/usr/bin/env bash
# scripts/admin/revoke-key.sh
#
# Thin wrapper around POST /api/v1/admin/revoke-key. The endpoint is the
# source of truth; this script just supplies the admin token from process
# env so an operator (or coding agent) doesn't need to remember the curl.
#
# Usage:
#   pnpm admin:revoke-key <key-id>
#
# Required process env:
#   ADMIN_TOKEN     — the static admin token. Source via `op run` or shell.
#
# Optional process env:
#   BOTPLACE_URL    — default http://localhost:3000

set -euo pipefail

KEY_ID="${1:-}"
if [ -z "$KEY_ID" ]; then
  printf 'usage: pnpm admin:revoke-key <key-id>\n' >&2
  exit 2
fi

URL="${BOTPLACE_URL:-http://localhost:3000}"
TOKEN="${ADMIN_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  printf 'ERROR: ADMIN_TOKEN missing in process env. Source via `op run --env-file ...` or export it.\n' >&2
  exit 2
fi

# `-f` makes curl fail on non-2xx so the script exits non-zero on errors.
exec curl -fsS -X POST "$URL/api/v1/admin/revoke-key" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"key_id":"%s"}' "$KEY_ID")"

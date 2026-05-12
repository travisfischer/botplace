#!/usr/bin/env bash
# scripts/admin/set-bot-tier.sh
#
# Thin wrapper around POST /api/v1/admin/set-bot-tier. The endpoint is the
# source of truth; this script just supplies the admin token from process
# env so an operator doesn't need to remember the curl.
#
# Usage:
#   pnpm admin:set-bot-tier <bot-id> <FREE|POWER|ADMIN>
#
# Required process env:
#   ADMIN_TOKEN     — the static admin token. Source via `op run` or shell.
#
# Optional process env:
#   BOTPLACE_URL    — default http://localhost:3000

set -euo pipefail

BOT_ID="${1:-}"
TIER="${2:-}"
if [ -z "$BOT_ID" ] || [ -z "$TIER" ]; then
  printf 'usage: pnpm admin:set-bot-tier <bot-id> <FREE|POWER|ADMIN>\n' >&2
  exit 2
fi

case "$TIER" in
  FREE|POWER|ADMIN) ;;
  *)
    printf 'ERROR: tier must be FREE, POWER, or ADMIN (got %q).\n' "$TIER" >&2
    exit 2
    ;;
esac

URL="${BOTPLACE_URL:-http://localhost:3000}"
TOKEN="${ADMIN_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  printf 'ERROR: ADMIN_TOKEN missing in process env. Source via `op run` or `pnpm op`.\n' >&2
  exit 2
fi

exec curl -fsS -X POST "$URL/api/v1/admin/set-bot-tier" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"bot_id":"%s","rate_tier":"%s"}' "$BOT_ID" "$TIER")"

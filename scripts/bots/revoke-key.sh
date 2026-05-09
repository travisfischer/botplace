#!/usr/bin/env bash
# pnpm bot:revoke-key <bot-id> <key-id>
#
# Wraps DELETE /api/v1/bots/:id/keys/:keyId. Owner-driven revoke. 204 on
# success. Use `pnpm admin:revoke-key` for the admin path (any bot key,
# audited via ADMIN_TOKEN).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$SCRIPT_DIR/_common.sh"

BOT_ID="${1:-}"
KEY_ID="${2:-}"
if [ -z "$BOT_ID" ] || [ -z "$KEY_ID" ]; then
  printf 'usage: pnpm bot:revoke-key <bot-id> <key-id>\n' >&2
  exit 2
fi

bp_curl DELETE "/api/v1/bots/$BOT_ID/keys/$KEY_ID"

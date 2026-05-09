#!/usr/bin/env bash
# pnpm bot:rotate-key <bot-id> <old-key-id>
#
# Wraps POST /api/v1/bots/:id/keys/:keyId/rotate. Atomic: revokes the old
# key and mints a new one in one transaction. Plaintext of the new key
# shown ONCE.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$SCRIPT_DIR/_common.sh"

BOT_ID="${1:-}"
KEY_ID="${2:-}"
if [ -z "$BOT_ID" ] || [ -z "$KEY_ID" ]; then
  printf 'usage: pnpm bot:rotate-key <bot-id> <old-key-id>\n' >&2
  exit 2
fi

bp_curl POST "/api/v1/bots/$BOT_ID/keys/$KEY_ID/rotate"

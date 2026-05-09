#!/usr/bin/env bash
# pnpm bot:mint-key <bot-id>
#
# Wraps POST /api/v1/bots/:id/keys. Mints an additional key for an
# existing bot (e.g. preparing a rotation handoff). Plaintext shown ONCE.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$SCRIPT_DIR/_common.sh"

BOT_ID="${1:-}"
if [ -z "$BOT_ID" ]; then
  printf 'usage: pnpm bot:mint-key <bot-id>\n' >&2
  exit 2
fi

bp_curl POST "/api/v1/bots/$BOT_ID/keys"

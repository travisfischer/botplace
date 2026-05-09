#!/usr/bin/env bash
# pnpm pat:revoke <token-id>
#
# Wraps DELETE /api/v1/owner/tokens/:id. 204 on success.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../bots/_common.sh
source "$SCRIPT_DIR/../bots/_common.sh"

TOKEN_ID="${1:-}"
if [ -z "$TOKEN_ID" ]; then
  printf 'usage: pnpm pat:revoke <token-id>\n' >&2
  exit 2
fi

bp_curl DELETE "/api/v1/owner/tokens/$TOKEN_ID"

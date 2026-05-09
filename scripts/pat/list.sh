#!/usr/bin/env bash
# pnpm pat:list
#
# Wraps GET /api/v1/owner/tokens. Lists PATs (no plaintext) including
# revoked ones, for audit-trail completeness.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../bots/_common.sh
source "$SCRIPT_DIR/../bots/_common.sh"

bp_curl GET /api/v1/owner/tokens

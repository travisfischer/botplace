#!/usr/bin/env bash
# pnpm pat:mint <name>
#
# Wraps POST /api/v1/owner/tokens. Mints a Personal Access Token. Plaintext
# shown ONCE — save it immediately. PATs are owner-scoped (full
# bot-management capability), so treat them like passwords.
#
# Note: this command needs an existing PAT in `BOTPLACE_PAT` to work —
# i.e. you can't bootstrap your first PAT from the shell. Use the browser
# UI at /bots once, then this script for everything afterward.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../bots/_common.sh
source "$SCRIPT_DIR/../bots/_common.sh"

NAME="${1:-}"
if [ -z "$NAME" ]; then
  printf 'usage: pnpm pat:mint <name>\n' >&2
  exit 2
fi

bp_curl POST /api/v1/owner/tokens -d "$(printf '{"name":"%s"}' "$NAME")"

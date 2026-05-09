#!/usr/bin/env bash
# pnpm bot:create <name>
#
# Wraps POST /api/v1/bots. Mints a bot + first key in one call. Plaintext
# is shown ONCE — pipe through jq or save the output.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$SCRIPT_DIR/_common.sh"

NAME="${1:-}"
if [ -z "$NAME" ]; then
  printf 'usage: pnpm bot:create <name>\n' >&2
  exit 2
fi

bp_curl POST /api/v1/bots -d "$(printf '{"name":"%s"}' "$NAME")"

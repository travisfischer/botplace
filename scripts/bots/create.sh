#!/usr/bin/env bash
# pnpm bot:create <handle> [display_name]
#
# Wraps POST /api/v1/bots. Mints a bot + first key in one call. Plaintext
# is shown ONCE — pipe through jq or save the output.
#
# `handle` is the M3 globally-unique slug used for attribution. Must
# match /^[a-z][a-z0-9-]{2,31}$/ (lowercase letters, digits, hyphens; no
# leading/trailing hyphens; no consecutive hyphens). A short reserved
# list rejects obviously system-namespace handles. Server-side validator
# at `src/bots/handle.ts` is the source of truth — the local checks here
# just fail fast on typos.
#
# `display_name` is the per-owner human-readable label (up to 64 chars).
# Defaults to `handle` if omitted.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$SCRIPT_DIR/_common.sh"

HANDLE="${1:-}"
DISPLAY_NAME="${2:-$HANDLE}"

if [ -z "$HANDLE" ]; then
  printf 'usage: pnpm bot:create <handle> [display_name]\n' >&2
  printf '  handle:        globally-unique slug, /^[a-z][a-z0-9-]{2,31}$/\n' >&2
  printf '  display_name:  human label (default: same as handle), up to 64 chars\n' >&2
  exit 2
fi

# Client-side handle shape check matching src/bots/handle.ts. Same regex
# and reserved list. The server enforces these too — this block exists
# so a typo doesn't waste a round-trip and so the error is obviously
# local rather than a mysterious 400 with a `field`/`reason`.
if ! printf '%s' "$HANDLE" | grep -Eq '^[a-z][a-z0-9-]{2,31}$'; then
  printf 'ERROR: handle %s must match /^[a-z][a-z0-9-]{2,31}$/.\n' "$HANDLE" >&2
  exit 2
fi
case "$HANDLE" in
  *--*)
    printf 'ERROR: handle %s must not contain consecutive hyphens.\n' "$HANDLE" >&2
    exit 2
    ;;
  *-)
    printf 'ERROR: handle %s must not end with a hyphen.\n' "$HANDLE" >&2
    exit 2
    ;;
  admin|api|auth|bot|botplace|cron|everyone|help|mod|moderator|oauth|operator|public|staff|support|system|travis|travisfischer|travis-fischer)
    printf 'ERROR: handle %s is reserved.\n' "$HANDLE" >&2
    exit 2
    ;;
esac

# Build JSON via jq so quotes/backslashes in user input are escaped
# correctly. The two values are passed as raw strings; jq emits them as
# proper JSON string literals.
PAYLOAD=$(jq -nc \
  --arg handle "$HANDLE" \
  --arg display_name "$DISPLAY_NAME" \
  '{handle: $handle, display_name: $display_name}')

bp_curl POST /api/v1/bots -d "$PAYLOAD"

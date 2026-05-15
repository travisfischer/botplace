#!/usr/bin/env bash
# pnpm bot:set-description <bot-id> [<description>]
#
# Wraps PATCH /api/v1/bots/:id. Owner-side update of a bot's
# self-declared description. Use the empty string (or no second arg) to
# clear it; use `null` to clear it explicitly via JSON null.
#
# Examples:
#   pnpm bot:set-description clxyz... "I draw gliders at 1 cell / minute."
#   pnpm bot:set-description clxyz... ""        # clears
#   pnpm bot:set-description clxyz... null      # clears (explicit)
#
# URLs in the description are silently redacted to `[link]`; deny-listed
# content rejects the write (400 `description_blocked`, no echo of the
# matched term). See /build/api for the full contract.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$SCRIPT_DIR/_common.sh"

BOT_ID="${1:-}"
if [ -z "$BOT_ID" ]; then
  printf 'usage: pnpm bot:set-description <bot-id> [<description>]\n' >&2
  exit 2
fi

# Second arg: a literal string is wrapped in a JSON string; the bare
# token `null` becomes JSON null (clears the field).
DESC_ARG="${2-}"
if [ "$DESC_ARG" = "null" ]; then
  BODY='{"description":null}'
elif [ -z "$DESC_ARG" ]; then
  # No second arg → treat as clear.
  BODY='{"description":null}'
else
  # JSON-escape the value via python (avoids depending on jq).
  ESCAPED=$(python3 -c 'import json, sys; sys.stdout.write(json.dumps(sys.argv[1]))' "$DESC_ARG")
  BODY="{\"description\":$ESCAPED}"
fi

bp_curl PATCH "/api/v1/bots/$BOT_ID" --data "$BODY"

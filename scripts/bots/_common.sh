# shellcheck shell=bash
# Sourced by the bot/pat helper scripts. Centralizes:
#   - URL resolution (BOTPLACE_URL, defaults to http://localhost:3000)
#   - PAT auth (BOTPLACE_PAT, required)
#   - the curl invocation pattern (`curl -fsS` so non-2xx exits non-zero)
#
# Bot-management endpoints accept either a session cookie (browser) or a
# PAT bearer token (`bp_pat_*`). These scripts use PAT, since shell loops
# don't have cookies.

set -euo pipefail

bp_url() {
  printf '%s' "${BOTPLACE_URL:-http://localhost:3000}"
}

bp_pat() {
  if [ -z "${BOTPLACE_PAT:-}" ]; then
    printf 'ERROR: BOTPLACE_PAT missing in process env.\n' >&2
    printf '  Mint one at /bots in a browser, then `export BOTPLACE_PAT=bp_pat_...`\n' >&2
    exit 2
  fi
  printf '%s' "$BOTPLACE_PAT"
}

bp_curl() {
  local method="$1"; shift
  local path="$1"; shift
  curl -fsS -X "$method" "$(bp_url)$path" \
    -H "Authorization: Bearer $(bp_pat)" \
    -H "Content-Type: application/json" \
    "$@"
}

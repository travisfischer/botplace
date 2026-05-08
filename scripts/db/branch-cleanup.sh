#!/usr/bin/env bash
# scripts/db/branch-cleanup.sh
#
# List or delete disposable Neon dev branches matching the auto-generated
# `dev-<8 hex chars>` pattern produced by `pnpm db:bootstrap`. Always
# protects `main`, `dev-main` (or NEON_DEV_MAIN_BRANCH), and the branch
# currently named in `.env`'s NEON_BRANCH_NAME.
#
# Branches that don't match the strict pattern (e.g. `dev-personal`,
# `preview/<...>`) are never touched — `preview/*` cleanup is handled by
# the Vercel↔Neon integration when the upstream git branch is deleted.
#
# Usage:
#   pnpm db:branch:cleanup           # interactive prompt
#   pnpm db:branch:cleanup --yes     # delete without prompt
#   pnpm db:branch:cleanup --dry-run # list candidates only
#
# Required process env: NEON_API_KEY, NEON_PROJECT_ID.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env"
NEON_API_BASE="https://console.neon.tech/api/v2"
export PROTECTED="${NEON_DEV_MAIN_BRANCH:-dev-main}"

DRY_RUN=0; YES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y)  YES=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
  esac
done

if [ -t 1 ]; then
  RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; DIM=$'\033[2m'; CLR=$'\033[0m'
else
  RED=""; GRN=""; YLW=""; DIM=""; CLR=""
fi
log()  { printf '%s%s%s\n' "$DIM" "$1" "$CLR"; }
fail() { printf '%sERROR:%s %s\n' "$RED" "$CLR" "$1" >&2; exit 1; }

[ -n "${NEON_API_KEY:-}" ]    || fail "NEON_API_KEY missing in process env. See docs/dev/secrets.md."
[ -n "${NEON_PROJECT_ID:-}" ] || fail "NEON_PROJECT_ID missing in process env."

# Protect the branch currently named in .env (likely the one the dev is using right now).
export CURRENT=""
if [ -f "$ENV_FILE" ]; then
  CURRENT=$(grep -E '^NEON_BRANCH_NAME=' "$ENV_FILE" 2>/dev/null \
             | tail -1 | sed -E 's/^NEON_BRANCH_NAME=//; s/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/' || echo "")
fi

BRANCHES_JSON=$(curl -sS -H "Authorization: Bearer $NEON_API_KEY" \
  "$NEON_API_BASE/projects/$NEON_PROJECT_ID/branches")
CANDIDATES=$(printf '%s' "$BRANCHES_JSON" | python3 -c "
import json, os, re, sys
protected = {os.environ['PROTECTED'], 'main'}
cur = os.environ.get('CURRENT', '')
if cur:
    protected.add(cur)
pat = re.compile(r'^dev-[0-9a-f]{8}$')
d = json.load(sys.stdin)
for b in d.get('branches', []):
    name = b['name']
    if name in protected:
        continue
    if pat.match(name):
        print(f'{b[\"id\"]}\t{name}')
")

if [ -z "$CANDIDATES" ]; then
  log "No disposable dev-<random> branches to clean up."
  if [ -n "$CURRENT" ]; then
    log "(current local branch '$CURRENT' is protected; '$PROTECTED' and 'main' are always protected.)"
  fi
  exit 0
fi

printf '%sBranches matching dev-<8 hex chars>:%s\n' "$YLW" "$CLR"
while IFS=$'\t' read -r id name; do
  printf '  %s  %s\n' "$id" "$name"
done <<< "$CANDIDATES"

if [ "$DRY_RUN" -eq 1 ]; then
  log "(dry-run) no branches deleted."
  exit 0
fi

if [ "$YES" -ne 1 ]; then
  printf '\nDelete these branches? [y/N] '
  read -r ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) log "abort."; exit 0 ;;
  esac
fi

failures=0
while IFS=$'\t' read -r id name; do
  printf '  delete %-40s ... ' "$name"
  resp=$(curl -sS -X DELETE -H "Authorization: Bearer $NEON_API_KEY" \
    "$NEON_API_BASE/projects/$NEON_PROJECT_ID/branches/$id")
  if printf '%s' "$resp" | python3 -c "import json,sys; sys.exit(0 if 'branch' in json.load(sys.stdin) else 1)" 2>/dev/null; then
    printf '%sok%s\n' "$GRN" "$CLR"
  else
    printf '%sfailed%s\n' "$RED" "$CLR"
    failures=$((failures+1))
  fi
done <<< "$CANDIDATES"

if [ "$failures" -gt 0 ]; then
  fail "$failures branch deletion(s) failed."
fi

printf '\n%scleanup done%s\n' "$GRN" "$CLR"

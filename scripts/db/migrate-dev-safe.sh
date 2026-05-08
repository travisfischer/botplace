#!/usr/bin/env bash
# scripts/db/migrate-dev-safe.sh
#
# Wrapper around `prisma migrate dev` that refuses to run against the
# production branch (`main`) or the shared baseline (`dev-main`). The
# guard reads NEON_BRANCH_NAME from process env first, then from .env,
# so an accidentally-set process-env override cannot bypass it.
#
# Override (e.g. for a deliberate baseline maintenance migration):
#   NEON_ALLOW_BASELINE_MIGRATE=1 pnpm db:migrate:dev --name <change>

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env"
DEV_MAIN_BRANCH="${NEON_DEV_MAIN_BRANCH:-dev-main}"

if [ -t 1 ]; then
  RED=$'\033[31m'; CLR=$'\033[0m'
else
  RED=""; CLR=""
fi
fail() { printf '%sERROR:%s %s\n' "$RED" "$CLR" "$1" >&2; exit 1; }

# Resolve current branch name: process env wins, then .env
BRANCH="${NEON_BRANCH_NAME:-}"
if [ -z "$BRANCH" ] && [ -f "$ENV_FILE" ]; then
  BRANCH=$(grep -E '^NEON_BRANCH_NAME=' "$ENV_FILE" 2>/dev/null \
           | tail -1 | sed -E 's/^NEON_BRANCH_NAME=//; s/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/' || echo "")
fi

if [ -z "$BRANCH" ]; then
  fail "NEON_BRANCH_NAME is unset. Run \`pnpm db:bootstrap\` first to materialize a dev branch."
fi

case "$BRANCH" in
  main|"$DEV_MAIN_BRANCH")
    if [ "${NEON_ALLOW_BASELINE_MIGRATE:-0}" = "1" ]; then
      printf 'WARN: running migrate dev on protected branch %s (NEON_ALLOW_BASELINE_MIGRATE=1)\n' "$BRANCH" >&2
    else
      fail "refusing to run \`prisma migrate dev\` on protected branch '$BRANCH'.
Reasons: 'main' is production; '$DEV_MAIN_BRANCH' is the shared baseline that other dev branches fork from.
Either run \`pnpm db:bootstrap\` to switch to a child branch, or pass NEON_ALLOW_BASELINE_MIGRATE=1 if this is a deliberate baseline maintenance migration."
    fi
    ;;
esac

exec pnpm exec prisma migrate dev "$@"

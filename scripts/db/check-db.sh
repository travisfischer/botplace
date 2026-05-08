#!/usr/bin/env bash
# scripts/db/check-db.sh
#
# Standalone DB connectivity check. Runs `SELECT 1` via Prisma's CLI,
# which reads the connection URL from prisma.config.ts (which in turn
# reads DATABASE_URL_UNPOOLED from .env via dotenv/config). Exits 0 on
# success, non-zero on failure. Never prints the connection string.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env"

if [ -t 1 ]; then
  RED=$'\033[31m'; GRN=$'\033[32m'; CLR=$'\033[0m'
else
  RED=""; GRN=""; CLR=""
fi
fail() { printf '%sERROR:%s %s\n' "$RED" "$CLR" "$1" >&2; exit 1; }

# Source .env so we can sanity-check that a URL is present and report the
# branch name. Prisma will re-read it itself via dotenv/config.
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE" 2>/dev/null || true
  set +a
fi

[ -n "${DATABASE_URL_UNPOOLED:-${DATABASE_URL:-}}" ] \
  || fail "neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set. Run \`pnpm db:bootstrap\` first."

BRANCH_NAME="${NEON_BRANCH_NAME:-(unknown)}"

# Prisma 7's `db execute --stdin` reads the URL from prisma.config.ts.
# We don't pass --url (deprecated in v7).
if ( cd "$ROOT" && echo "SELECT 1" | pnpm exec prisma db execute --stdin ) >/dev/null 2>&1; then
  printf '%sDB OK%s  branch=%s\n' "$GRN" "$CLR" "$BRANCH_NAME"
  exit 0
fi

fail "DB connectivity check failed (branch=$BRANCH_NAME). The .env values are present but the DB is not responding via Prisma."

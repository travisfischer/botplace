#!/usr/bin/env bash
# scripts/env/check-env.sh
#
# Reports presence of Botplace's required env vars by name, never by value.
# Exits non-zero if any required var is missing.
#
# Reads .env at the repo root (Botplace's canonical local env file) if it
# exists. Long-lived automation credentials (NEON_API_KEY, etc.) come from
# process env via whatever adapter populated it: cloud-agent platform
# secrets, `op run`, manual export.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env"

# stdout coloring; suppress when not a TTY
if [ -t 1 ]; then
  RED=$'\033[31m'; GRN=$'\033[32m'; DIM=$'\033[2m'; CLR=$'\033[0m'
else
  RED=""; GRN=""; DIM=""; CLR=""
fi

# Load .env if present, but do not let its parse errors abort us.
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE" 2>/dev/null || true
  set +a
fi

missing=0
section() { printf '\n%s%s%s\n' "$DIM" "$1" "$CLR"; }
check() {
  local name=$1
  local val
  val=$(eval "printf '%s' \"\${$name:-}\"")
  if [ -n "$val" ]; then
    printf '  %s✓%s %s\n' "$GRN" "$CLR" "$name"
  else
    printf '  %s✗%s %s  %sMISSING%s\n' "$RED" "$CLR" "$name" "$DIM" "$CLR"
    missing=$((missing+1))
  fi
}

section "Process env (long-lived automation credentials):"
check NEON_API_KEY
check NEON_PROJECT_ID

section "Local env file ($ENV_FILE):"
check DATABASE_URL
check DATABASE_URL_UNPOOLED
check NEON_BRANCH_NAME
check BOTPLACE_API_KEY_PEPPER
check AUTH_SECRET
check GOOGLE_CLIENT_ID

section "Process env (per-session, sourced via op run / shell export):"
check GOOGLE_CLIENT_SECRET
check ADMIN_TOKEN

# Upstash: either canonical SDK names OR Vercel↔Upstash KV-style names.
# In dev, neither is required (lib/rate-limit.ts falls back to in-memory).
# In prod, one pair is required.
section "Upstash rate limit (production-only — dev uses in-memory fallback):"
upstash_url="${UPSTASH_REDIS_REST_URL:-${KV_REST_API_URL:-}}"
upstash_token="${UPSTASH_REDIS_REST_TOKEN:-${KV_REST_API_TOKEN:-}}"
if [ -n "$upstash_url" ] && [ -n "$upstash_token" ]; then
  printf '  %s✓%s UPSTASH/KV REST URL + TOKEN present\n' "$GRN" "$CLR"
else
  printf '  %s○%s UPSTASH/KV REST URL + TOKEN absent  %s(dev fallback active)%s\n' "$DIM" "$CLR" "$DIM" "$CLR"
fi

printf '\n'
if [ "$missing" -gt 0 ]; then
  printf '%s%d required env var(s) missing.%s\n' "$RED" "$missing" "$CLR"
  printf '  - For NEON_* process-env vars: export from your shell, source from a cloud-agent platform secret, or run with `op run --env-file <ref-template> -- ...`.\n'
  printf '  - For local-env-file vars: run `pnpm db:bootstrap` to materialize a Neon dev branch.\n'
  exit 1
fi

printf '%senv OK%s\n' "$GRN" "$CLR"

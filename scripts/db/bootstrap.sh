#!/usr/bin/env bash
# scripts/db/bootstrap.sh
#
# Create or reuse a Neon dev branch off `dev-main`, write the disposable
# allow-list values to `.env`, and run `prisma migrate deploy`.
#
# Required process env:
#   NEON_API_KEY        - Neon API key with access to the project
#   NEON_PROJECT_ID     - Neon project id (e.g. lingering-truth-24789579)
#
# Optional process env:
#   NEON_BRANCH_NAME       - reuse this specific child branch (must exist and
#                            must not be `main` or `dev-main`). Falls back to
#                            the value in .env, then to a fresh `dev-<random>`.
#   NEON_DEV_MAIN_BRANCH   - baseline branch name (default: dev-main)
#
# Idempotent. Reusing a branch refreshes its connection URLs in `.env`.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env"
NEON_API_BASE="https://console.neon.tech/api/v2"
DEV_MAIN_BRANCH="${NEON_DEV_MAIN_BRANCH:-dev-main}"

if [ -t 1 ]; then
  RED=$'\033[31m'; GRN=$'\033[32m'; DIM=$'\033[2m'; CLR=$'\033[0m'
else
  RED=""; GRN=""; DIM=""; CLR=""
fi
log()   { printf '%s%s%s\n' "$DIM" "$1" "$CLR"; }
ok()    { printf '%s✓%s %s\n' "$GRN" "$CLR" "$1"; }
fail()  { printf '%sERROR:%s %s\n' "$RED" "$CLR" "$1" >&2; exit 1; }

[ -n "${NEON_API_KEY:-}" ]    || fail "NEON_API_KEY missing in process env. See docs/dev/secrets.md."
[ -n "${NEON_PROJECT_ID:-}" ] || fail "NEON_PROJECT_ID missing in process env."

api() {
  local method="$1"; local path="$2"; shift 2
  if [ "$method" = "GET" ]; then
    curl -sS -H "Authorization: Bearer $NEON_API_KEY" "$NEON_API_BASE$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $NEON_API_KEY" -H "Content-Type: application/json" "$NEON_API_BASE$path" "$@"
  fi
}

# Resolve baseline branch id
log "Looking up baseline branch '$DEV_MAIN_BRANCH'..."
BRANCHES_JSON=$(api GET "/projects/$NEON_PROJECT_ID/branches")
DEV_MAIN_ID=$(printf '%s' "$BRANCHES_JSON" | NAME="$DEV_MAIN_BRANCH" python3 -c "
import json, os, sys
name = os.environ['NAME']
d = json.load(sys.stdin)
for b in d.get('branches', []):
    if b['name'] == name:
        print(b['id'])
        break
")
[ -n "$DEV_MAIN_ID" ] || fail "baseline branch '$DEV_MAIN_BRANCH' not found in project $NEON_PROJECT_ID. Create it once (e.g. via Neon API or dashboard) before bootstrapping."
ok "baseline $DEV_MAIN_BRANCH ($DEV_MAIN_ID)"

# Pick target branch: process env wins, then .env, then generate fresh
TARGET_BRANCH="${NEON_BRANCH_NAME:-}"
if [ -z "$TARGET_BRANCH" ] && [ -f "$ENV_FILE" ]; then
  TARGET_BRANCH=$(grep -E '^NEON_BRANCH_NAME=' "$ENV_FILE" 2>/dev/null \
                  | tail -1 | sed -E 's/^NEON_BRANCH_NAME=//; s/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/' || echo "")
fi

# Refuse to use main/dev-main as a child branch
case "$TARGET_BRANCH" in
  main|"$DEV_MAIN_BRANCH")
    fail "refusing to use protected branch '$TARGET_BRANCH' as a dev child branch. Pick another NEON_BRANCH_NAME or unset it to generate one."
    ;;
esac

BRANCH_ID=""
if [ -n "$TARGET_BRANCH" ]; then
  BRANCH_ID=$(printf '%s' "$BRANCHES_JSON" | NAME="$TARGET_BRANCH" python3 -c "
import json, os, sys
name = os.environ['NAME']
d = json.load(sys.stdin)
for b in d.get('branches', []):
    if b['name'] == name:
        print(b['id'])
        break
")
  if [ -n "$BRANCH_ID" ]; then
    ok "reusing branch $TARGET_BRANCH ($BRANCH_ID)"
  else
    log "branch '$TARGET_BRANCH' not found on Neon; will create."
  fi
fi

if [ -z "$BRANCH_ID" ]; then
  if [ -z "$TARGET_BRANCH" ]; then
    SUFFIX=$(openssl rand -hex 4 2>/dev/null || head -c 4 /dev/urandom | xxd -p)
    TARGET_BRANCH="dev-$SUFFIX"
  fi
  log "creating branch '$TARGET_BRANCH' off '$DEV_MAIN_BRANCH'..."
  RESP=$(api POST "/projects/$NEON_PROJECT_ID/branches" --data "$(printf '{"branch":{"name":"%s","parent_id":"%s"},"endpoints":[{"type":"read_write"}]}' "$TARGET_BRANCH" "$DEV_MAIN_ID")")
  BRANCH_ID=$(printf '%s' "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin)
b = d.get('branch') or {}
if not b.get('id'):
    print('PARSE_ERROR', file=sys.stderr)
    sys.exit(2)
print(b['id'])
") || fail "Neon branch creation failed: $RESP"
  ok "created $TARGET_BRANCH ($BRANCH_ID)"
fi

# Discover database + role for connection URI
log "resolving database/role on branch..."
DATABASE_NAME=$(api GET "/projects/$NEON_PROJECT_ID/branches/$BRANCH_ID/databases" | python3 -c "
import json, sys
d = json.load(sys.stdin).get('databases') or []
print(d[0]['name'] if d else '')
")
ROLE_NAME=$(api GET "/projects/$NEON_PROJECT_ID/branches/$BRANCH_ID/roles" | python3 -c "
import json, sys
d = json.load(sys.stdin).get('roles') or []
print(d[0]['name'] if d else '')
")
[ -n "$DATABASE_NAME" ] || fail "no database found on branch $TARGET_BRANCH"
[ -n "$ROLE_NAME" ]     || fail "no role found on branch $TARGET_BRANCH"

# Fetch pooled and unpooled connection URIs
fetch_uri() {
  local pooled="$1"
  api GET "/projects/$NEON_PROJECT_ID/connection_uri?branch_id=$BRANCH_ID&database_name=$DATABASE_NAME&role_name=$ROLE_NAME&pooled=$pooled" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('uri',''))"
}
log "fetching connection URIs..."
POOLED_URI=$(fetch_uri true)
UNPOOLED_URI=$(fetch_uri false)
[ -n "$POOLED_URI" ]   || fail "Neon API did not return a pooled connection URI."
[ -n "$UNPOOLED_URI" ] || fail "Neon API did not return an unpooled connection URI."

# Resolve disposable per-branch dev secrets. Preserve any existing value so
# previously-minted dev keys / sessions stay valid across bootstrap re-runs;
# otherwise generate a fresh 32-byte hex secret. Production secrets live in
# Vercel project env + 1Password and are never written to disk locally.
read_env_value() {
  local var_name="$1"
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^${var_name}=" "$ENV_FILE" 2>/dev/null \
    | tail -1 \
    | sed -E "s/^${var_name}=//; s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/" \
    || true
}
generate_secret() {
  openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n'
}

DEV_PEPPER=$(read_env_value BOTPLACE_API_KEY_PEPPER)
if [ -z "$DEV_PEPPER" ]; then
  DEV_PEPPER=$(generate_secret)
  log "generated fresh dev pepper for $TARGET_BRANCH"
else
  log "preserving existing dev pepper from $ENV_FILE"
fi

DEV_AUTH_SECRET=$(read_env_value AUTH_SECRET)
if [ -z "$DEV_AUTH_SECRET" ]; then
  DEV_AUTH_SECRET=$(generate_secret)
  log "generated fresh AUTH_SECRET for $TARGET_BRANCH"
else
  log "preserving existing AUTH_SECRET from $ENV_FILE"
fi

# Google OAuth client ID (non-secret). Process env wins (op.env injects via
# `pnpm op db:bootstrap`; cloud-agent platforms inject directly); otherwise
# preserve the previous .env value. If neither is set, omit — Google sign-in
# simply won't work until GOOGLE_CLIENT_ID is supplied.
if [ -n "${GOOGLE_CLIENT_ID:-}" ]; then
  DEV_GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID"
else
  DEV_GOOGLE_CLIENT_ID=$(read_env_value GOOGLE_CLIENT_ID)
fi

# Write .env atomically (allow-list only — no NEON_API_KEY etc.)
log "writing $ENV_FILE..."
TMP=$(mktemp)
cat > "$TMP" <<EOF
# Generated by pnpm db:bootstrap. Regenerated on each run.
# Disposable Neon dev branch values only — see docs/dev/secrets.md.
# Do not commit. Do not paste.

DATABASE_URL="$POOLED_URI"
DATABASE_URL_UNPOOLED="$UNPOOLED_URI"
NEON_BRANCH_NAME="$TARGET_BRANCH"
BOTPLACE_API_KEY_PEPPER="$DEV_PEPPER"
AUTH_SECRET="$DEV_AUTH_SECRET"
EOF
[ -n "$DEV_GOOGLE_CLIENT_ID" ] && printf 'GOOGLE_CLIENT_ID="%s"\n' "$DEV_GOOGLE_CLIENT_ID" >> "$TMP"
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok "$ENV_FILE updated (allow-list values only)"

# Apply migrations
log "applying migrations on $TARGET_BRANCH..."
( cd "$ROOT" && pnpm db:migrate:deploy ) >/dev/null
ok "migrations applied"

# Final connectivity probe (uses .env via dotenv inside db:check)
"$ROOT/scripts/db/check-db.sh" >/dev/null && ok "DB connectivity verified" \
  || fail "DB connectivity check failed after bootstrap. Inspect with: pnpm db:check"

printf '\n%sbootstrap complete.%s branch=%s\n' "$GRN" "$CLR" "$TARGET_BRANCH"
printf 'Next: %spnpm dev%s   or   %spnpm db:migrate:dev --name <change>%s\n' "$DIM" "$CLR" "$DIM" "$CLR"

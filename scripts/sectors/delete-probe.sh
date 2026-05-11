#!/usr/bin/env bash
# pnpm sector:delete-probe <sector_id>
#
# Tear down a probe sector created by `pnpm sector:create-probe`.
# Refuses to delete `sector-1` (the production sector) as a tripwire,
# and refuses any sector that doesn't start with the `probe-` or
# `*-probe` slug pattern unless --force is passed.
#
# Cascade order matches the M1 Restrict policy: pixel_events →
# sector_chunks → sectors. Bot/owner/key rows are left alone.

set -euo pipefail

SECTOR_ID="${1:-}"
FORCE="${2:-}"

if [ -z "$SECTOR_ID" ]; then
  printf 'usage: pnpm sector:delete-probe <sector_id> [--force]\n' >&2
  exit 2
fi

if [ "$SECTOR_ID" = "sector-1" ]; then
  printf 'ERROR: refusing to delete sector-1 (production sector).\n' >&2
  exit 2
fi

if ! [[ "$SECTOR_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'ERROR: sector_id must match [A-Za-z0-9_-]+ (got %q).\n' "$SECTOR_ID" >&2
  exit 2
fi

# Tripwire: only auto-delete obvious probe sectors. `--force` overrides
# for the cleanup-after-the-fact case.
if [ "$FORCE" != "--force" ] && \
   ! [[ "$SECTOR_ID" =~ ^probe- ]] && \
   ! [[ "$SECTOR_ID" =~ -probe$ ]]; then
  printf 'ERROR: %q does not look like a probe sector. Pass --force to delete anyway.\n' "$SECTOR_ID" >&2
  exit 2
fi

URL="${DATABASE_URL_UNPOOLED:-${DATABASE_URL:-}}"
if [ -z "$URL" ]; then
  printf 'ERROR: DATABASE_URL or DATABASE_URL_UNPOOLED must be set in process env.\n' >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  printf 'ERROR: psql not on PATH.\n' >&2
  exit 2
fi

psql "$URL" -At -c "
  BEGIN;
  DELETE FROM pixel_events WHERE sector_id = '$SECTOR_ID';
  DELETE FROM sector_chunks WHERE sector_id = '$SECTOR_ID';
  DELETE FROM sectors WHERE id = '$SECTOR_ID' RETURNING id;
  COMMIT;
"

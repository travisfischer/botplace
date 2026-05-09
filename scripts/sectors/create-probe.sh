#!/usr/bin/env bash
# pnpm sector:create-probe <sector_id> [width] [height]
#
# Insert a fresh empty sector row directly via psql. Used by Probe 8
# ("Empty-canvas first paint") in docs/dev/probes/m2-viewer.md so the
# probe can run unattended in any cloud sandbox — no Prisma Studio GUI,
# no transient code edits.
#
# Defaults: width=1000, height=1000, palette_version=1. The sector
# starts empty (zero SectorChunk rows) — the manifest endpoint will
# return [] and the viewer will paint the default color.
#
# Use `pnpm sector:delete-probe <sector_id>` to clean up afterwards.

set -euo pipefail

SECTOR_ID="${1:-}"
WIDTH="${2:-1000}"
HEIGHT="${3:-1000}"

if [ -z "$SECTOR_ID" ]; then
  printf 'usage: pnpm sector:create-probe <sector_id> [width] [height]\n' >&2
  exit 2
fi

# Slug shape gate — sector_id is interpolated into the SQL string, so
# reject anything that isn't a safe slug. Same regex as events:export.
if ! [[ "$SECTOR_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'ERROR: sector_id must match [A-Za-z0-9_-]+ (got %q).\n' "$SECTOR_ID" >&2
  exit 2
fi
if ! [[ "$WIDTH" =~ ^[1-9][0-9]*$ ]] || ! [[ "$HEIGHT" =~ ^[1-9][0-9]*$ ]]; then
  printf 'ERROR: width/height must be positive integers.\n' >&2
  exit 2
fi

URL="${DATABASE_URL_UNPOOLED:-${DATABASE_URL:-}}"
if [ -z "$URL" ]; then
  printf 'ERROR: DATABASE_URL or DATABASE_URL_UNPOOLED must be set in process env.\n' >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  printf 'ERROR: psql not on PATH. brew install libpq && brew link --force libpq.\n' >&2
  exit 2
fi

# `id` is the slug; `name` mirrors it for human-readable display.
psql "$URL" -At -c "
  INSERT INTO sectors (id, name, width, height, palette_version, created_at)
  VALUES ('$SECTOR_ID', '$SECTOR_ID', $WIDTH, $HEIGHT, 1, now())
  ON CONFLICT (id) DO NOTHING
  RETURNING id;
"

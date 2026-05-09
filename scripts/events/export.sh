#!/usr/bin/env bash
# pnpm events:export [sector_id]
#
# Stream `pixel_events` rows to stdout as one JSON object per line (JSONL).
# Order: `(sector_id ASC, id ASC)` — same order replay uses.
#
# Reads `DATABASE_URL` (or `DATABASE_URL_UNPOOLED`) from process env.
# With no argument, dumps every sector. With one positional argument,
# restricts to that sector.
#
# Requires `psql` on PATH. The output is plain JSONL — pipe it to `jq`
# for inspection, or to `aws s3 cp - s3://…` for archival.

set -euo pipefail

URL="${DATABASE_URL_UNPOOLED:-${DATABASE_URL:-}}"
if [ -z "$URL" ]; then
  printf 'ERROR: DATABASE_URL or DATABASE_URL_UNPOOLED must be set in process env.\n' >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  printf 'ERROR: psql not on PATH. brew install libpq && brew link --force libpq, or use the Postgres app.\n' >&2
  exit 2
fi

SECTOR_FILTER="${1:-}"
WHERE_CLAUSE=""
if [ -n "$SECTOR_FILTER" ]; then
  # The sector id is read from the shell as plain text; reject anything
  # other than the slug shape we use (`[A-Za-z0-9_-]+`) so nothing user-
  # controllable ends up inside the SQL string.
  if ! [[ "$SECTOR_FILTER" =~ ^[A-Za-z0-9_-]+$ ]]; then
    printf 'ERROR: sector_id must match [A-Za-z0-9_-]+ (got %q).\n' "$SECTOR_FILTER" >&2
    exit 2
  fi
  WHERE_CLAUSE="WHERE sector_id = '$SECTOR_FILTER'"
fi

# json_build_object renders the row server-side; row_to_json would also
# work but it picks the column names — we want explicit snake_case +
# stringified BigInts so consumers don't need to know the Postgres types.
psql "$URL" -At -c "
  SELECT json_build_object(
    'id',                  id::text,
    'request_id',          request_id,
    'sector_id',           sector_id,
    'x',                   x,
    'y',                   y,
    'color',               color,
    'palette_version',     palette_version,
    'bot_id',              bot_id,
    'api_key_id',          api_key_id,
    'chunk_version_after', chunk_version_after::text,
    'created_at',          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
  )::text
  FROM pixel_events
  $WHERE_CLAUSE
  ORDER BY sector_id ASC, id ASC
"

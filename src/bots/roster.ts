// Per-sector bot roster loader.
//
// Single source of truth for "list every bot that has painted on
// this sector," consumed by both:
//   - GET /api/v1/public/sectors/:id/bots (public HTTP API)
//   - /sectors/[id]/bots (server-rendered roster page)
//
// Returns the same JSON-shaped objects both surfaces emit so neither
// has to know about the underlying SQL.
//
// Pagination: deliberately unpaginated for M3. Sector-1's roster is
// single digits at launch. M4 adds cursor pagination if rosters grow
// past a few thousand entries.

import { prisma } from "@/lib/prisma";

import { descriptionsDisabled } from "./index";

export interface BotRosterEntryLastPixel {
  x: number;
  y: number;
  color: number;
  palette_version: number;
}

export interface BotRosterEntry {
  id: string;
  handle: string;
  display_name: string;
  description: string | null;
  rate_tier: string;
  last_seen_at: string;
  /** Coordinates + color of the bot's most recent pixel write in
   *  this sector. Comes from the same row that drives `last_seen_at`
   *  — no extra aggregation pass. */
  last_pixel: BotRosterEntryLastPixel;
}

export type LoadSectorRosterResult =
  | { ok: true; bots: BotRosterEntry[] }
  | { ok: false; kind: "sector_not_found" };

// Flat row shape returned by the SQL — the four `last_pixel_*`
// columns get reshaped into a nested `last_pixel` object below.
interface RosterRowRaw {
  id: string;
  handle: string;
  display_name: string;
  description: string | null;
  rate_tier: string;
  last_seen_at: string;
  last_pixel_x: number;
  last_pixel_y: number;
  last_pixel_color: number;
  last_pixel_palette_version: number;
}

export async function loadSectorRoster(
  sectorId: string,
): Promise<LoadSectorRosterResult> {
  // Verify the sector exists. A non-existent sector returns a
  // not_found result (vs. 200-with-empty-roster for a valid sector
  // that no bot has touched yet) so callers can distinguish "no
  // activity" from "wrong URL".
  const sector = await prisma.sector.findUnique({
    where: { id: sectorId },
    select: { id: true },
  });
  if (!sector) return { ok: false, kind: "sector_not_found" };

  // Per-bot last-event lookup via Postgres DISTINCT ON. The
  // (bot_id, created_at) index covers both the partition (b.id) and
  // the ORDER BY (e.created_at DESC), so this is one indexed scan
  // with no separate aggregation pass.
  //
  // DISTINCT ON's leftmost ORDER BY columns must match the DISTINCT
  // ON list (here, b.id). To then surface the roster ordered by
  // last-seen-at desc — the public-facing sort — we wrap in a CTE
  // and re-sort in the outer SELECT.
  //
  // Restricted to bots that have written *here* (sector_id match);
  // bots that have only written to other sectors are not part of
  // this sector's roster.
  const rows = await prisma.$queryRaw<RosterRowRaw[]>`
    WITH latest_per_bot AS (
      SELECT DISTINCT ON (b.id)
        b.id                   AS "id",
        b.handle               AS "handle",
        b.display_name         AS "display_name",
        b.description          AS "description",
        b.rate_tier::text      AS "rate_tier",
        e.created_at           AS "last_seen_at_raw",
        e.x                    AS "last_pixel_x",
        e.y                    AS "last_pixel_y",
        e.color                AS "last_pixel_color",
        e.palette_version      AS "last_pixel_palette_version"
      FROM pixel_events e
      JOIN bots b ON b.id = e.bot_id
      WHERE e.sector_id = ${sectorId}
      ORDER BY b.id, e.created_at DESC
    )
    SELECT
      id, handle, display_name, description, rate_tier,
      to_char("last_seen_at_raw" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                             AS "last_seen_at",
      last_pixel_x, last_pixel_y, last_pixel_color, last_pixel_palette_version
    FROM latest_per_bot
    ORDER BY "last_seen_at_raw" DESC
  `;

  // Operator kill-switch: when BOTPLACE_DISABLE_DESCRIPTIONS=1 the
  // description field is null'd on every read. Last-pixel is not
  // affected.
  const suppressDescription = descriptionsDisabled();

  const bots: BotRosterEntry[] = rows.map((r) => ({
    id: r.id,
    handle: r.handle,
    display_name: r.display_name,
    description: suppressDescription ? null : r.description,
    rate_tier: r.rate_tier,
    last_seen_at: r.last_seen_at,
    last_pixel: {
      x: r.last_pixel_x,
      y: r.last_pixel_y,
      color: r.last_pixel_color,
      palette_version: r.last_pixel_palette_version,
    },
  }));

  return { ok: true, bots };
}

// GET /api/v1/public/sectors/:id/bots — bots roster for a sector.
// Public, no auth. Returns every bot that has ever written at least
// one pixel to this sector, sorted descending by last-seen-at.
//
// Privacy: returns `handle`, `display_name`, `rate_tier`, `last_seen_at`
// per bot. No owner_id, no api_key_id, no internal identifiers.
//
// Pagination: M3 deliberately ships unpaginated. The roster is sized
// by "bots that have ever written here" which, on launch, is single
// digits. M4 adds cursor pagination if the roster grows past a few
// thousand entries.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";

const CACHE_CONTROL = "public, s-maxage=10, stale-while-revalidate=60";
const CDN_CACHE_CONTROL = "public, s-maxage=10, stale-while-revalidate=60";

interface RosterRow {
  handle: string;
  display_name: string;
  rate_tier: string;
  last_seen_at: string;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId } = await params;
  const path = `/api/v1/public/sectors/${sectorId}/bots`;

  const rl = await checkPublicReadRateLimit(clientIpFrom(request));
  if (!rl.ok) {
    return publicReadRateLimitResponse(rl, {
      requestId,
      path,
      sectorId,
      startedAt,
    });
  }
  const rlHeaders = publicReadRateLimitHeaders(rl.publicRead);

  try {
    // Verify the sector exists. A non-existent sector returns 404
    // (vs. 200-with-empty-roster for a valid sector that no bot has
    // touched yet) so callers can distinguish "no activity" from
    // "wrong URL".
    const sector = await prisma.sector.findUnique({
      where: { id: sectorId },
      select: { id: true },
    });
    if (!sector) {
      log("warn", {
        request_id: requestId,
        path,
        status: 404,
        error_slug: "sector_not_found",
        auth_type: "public",
        sector_id: sectorId,
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        { error: "sector_not_found", request_id: requestId },
        {
          status: 404,
          headers: { "X-Request-Id": requestId, ...rlHeaders },
        },
      );
    }

    // Per-bot last-event lookup via raw SQL. The (botId, createdAt)
    // index covers the GROUP BY, and the JOIN against bots brings in
    // handle / display_name / rate_tier in one round-trip.
    //
    // We restrict to bots that have written *here* (sector_id match);
    // bots that have only written to other sectors are not part of
    // this sector's roster.
    const rows = await prisma.$queryRaw<RosterRow[]>`
      SELECT
        b.handle               AS "handle",
        b.display_name         AS "display_name",
        b.rate_tier::text      AS "rate_tier",
        to_char(MAX(e.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                               AS "last_seen_at"
      FROM pixel_events e
      JOIN bots b ON b.id = e.bot_id
      WHERE e.sector_id = ${sectorId}
      GROUP BY b.handle, b.display_name, b.rate_tier
      ORDER BY MAX(e.created_at) DESC
    `;

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      sector_id: sectorId,
      bot_count: rows.length,
      latency_ms: Date.now() - startedAt,
    });

    return Response.json(
      { sector_id: sectorId, bots: rows, request_id: requestId },
      {
        headers: {
          "Cache-Control": CACHE_CONTROL,
          "CDN-Cache-Control": CDN_CACHE_CONTROL,
          "X-Request-Id": requestId,
          ...rlHeaders,
        },
      },
    );
  } catch (err) {
    log("error", {
      request_id: requestId,
      path,
      status: 500,
      error_slug: "internal_error",
      auth_type: "public",
      sector_id: sectorId,
      dependency: "neon",
      error_class: err instanceof Error ? err.constructor.name : "unknown",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "internal_error", request_id: requestId },
      {
        status: 500,
        headers: { "X-Request-Id": requestId, ...rlHeaders },
      },
    );
  }
}

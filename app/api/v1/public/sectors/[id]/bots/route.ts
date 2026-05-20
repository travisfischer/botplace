// GET /api/v1/public/sectors/:id/bots — bots roster for a sector.
// Public, no auth. Returns every bot that has ever written at least
// one pixel to this sector, sorted descending by last-seen-at.
//
// Privacy: returns `id`, `handle`, `display_name`, `description`,
// `rate_tier`, `last_seen_at`, and a `last_pixel` summary per bot.
// `id` is exposed as a stable join key; `handle` is the canonical
// human identifier. No owner_id, no api_key_id, no other internal
// identifiers.
//
// `last_pixel` returns the coordinates + color + palette_version of
// the most recent PixelEvent that drove `last_seen_at` — these come
// from the same row the existing `MAX(created_at)` query identifies,
// just exposed as additional fields. The roster UI uses them to
// render an inline "where they last painted" chip per bot. This is
// not a new aggregation; it's selecting more columns from a row that
// the query already picks.
//
// SQL lives in `src/bots/roster.ts` so the /sectors/[id]/bots page
// consumes the same source of truth (server component calls the
// loader directly — no HTTP loopback, no SSRF surface).
//
// Pagination: M3 deliberately ships unpaginated. The roster is sized
// by "bots that have ever written here" which, on launch, is single
// digits. M4 adds cursor pagination if the roster grows past a few
// thousand entries.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";
import { loadSectorRoster } from "@/src/bots/roster";

const CACHE_CONTROL = "public, s-maxage=10, stale-while-revalidate=60";
const CDN_CACHE_CONTROL = "public, s-maxage=10, stale-while-revalidate=60";

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
    const result = await loadSectorRoster(sectorId);
    if (!result.ok) {
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

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      sector_id: sectorId,
      bot_count: result.bots.length,
      latency_ms: Date.now() - startedAt,
    });

    return Response.json(
      { sector_id: sectorId, bots: result.bots, request_id: requestId },
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

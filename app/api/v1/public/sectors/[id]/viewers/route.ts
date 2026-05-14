// GET /api/v1/public/sectors/:id/viewers — approximate active viewer
// count over a rolling ~2-minute window. Used by the M2.5 visitor-pulse
// bot and useful for any reactive bot that wants to react to audience
// size.
//
// Implementation: the viewer client posts to
// `/api/v1/public/sectors/:id/heartbeat` once per minute while its tab
// is visible; that endpoint writes the caller's IP into a per-minute
// Redis SET. This endpoint reads the union of the current + previous
// minute sets.
//
// The numerator is "approximate" because:
//   - Only clients that ran the viewer JS are counted (a crawler that
//     scrapes the public API without executing JS is invisible — a
//     deliberate change from the M2.5 edge-middleware design to avoid
//     paying Upstash commands per scraper request).
//   - Bot egress IPs are NOT excluded (per M2.5 decision #5).
//   - Multiple users behind a NAT collapse to one IP.
//   - The window is bucketed by wall-clock minute, so a viewer who
//     just heartbeat'd in the previous minute counts even if they've
//     since closed the tab.
// All biases are small at our launch scale; the count is
// directional, not exact.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import { Redis } from "@upstash/redis";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";

const CACHE_CONTROL = "public, s-maxage=15, stale-while-revalidate=60";
const CDN_CACHE_CONTROL = "public, s-maxage=15, stale-while-revalidate=60";
const WINDOW_SECONDS = 120;

// Reuse one client per Node lambda instance.
let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (redis) return redis;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId } = await params;
  const path = `/api/v1/public/sectors/${sectorId}/viewers`;

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
    // M2.5: sector_id is captured for forward compatibility (per-sector
    // viewer counts) but the heartbeat endpoint currently writes to one
    // global bucket per minute. When we add multi-sector support, the
    // heartbeat can switch to per-sector keys keyed on sectorId.
    const r = getRedis();
    let active = 0;
    if (r) {
      try {
        const now = Math.floor(Date.now() / 60_000);
        const prev = now - 1;
        // SUNION returns the union as a list; we only need its size.
        // Pipeline: scard both, sum in code (cheaper than SUNIONSTORE).
        const [curr, prevCount] = (await r
          .pipeline()
          .scard(`botplace:viewers:${now}`)
          .scard(`botplace:viewers:${prev}`)
          .exec()) as [number, number];
        // SCARD overcounts uniques across minutes (a viewer present in
        // both counts twice), but it's bounded by 2x and saves us the
        // SUNION network cost. For "directional, not exact" purposes
        // the bound is fine.
        active = (curr ?? 0) + (prevCount ?? 0);
      } catch (err) {
        log("warn", {
          request_id: requestId,
          path,
          status: 200,
          auth_type: "public",
          sector_id: sectorId,
          error_slug: "viewers_read_failed",
          error_class: err instanceof Error ? err.constructor.name : "unknown",
          dependency: "upstash",
        });
        // Fall through with active=0; the endpoint is best-effort.
      }
    }

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      sector_id: sectorId,
      viewer_count: active,
      latency_ms: Date.now() - startedAt,
    });

    return Response.json(
      { active, window_seconds: WINDOW_SECONDS, request_id: requestId },
      {
        headers: {
          "Cache-Control": CACHE_CONTROL,
          "CDN-Cache-Control": CDN_CACHE_CONTROL,
          ...rlHeaders,
        },
      },
    );
  } catch (err) {
    // Outer try/catch so any unexpected throw outside the rate-limit
    // helper still surfaces a structured `internal_error` with
    // `request_id` rather than Next's generic 500 page.
    log("error", {
      request_id: requestId,
      path,
      status: 500,
      auth_type: "public",
      sector_id: sectorId,
      error_slug: "internal_error",
      error_class: err instanceof Error ? err.constructor.name : "unknown",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "internal_error", request_id: requestId },
      { status: 500 },
    );
  }
}

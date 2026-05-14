// POST /api/v1/public/sectors/:id/heartbeat — client beacon that
// records "viewer is present" for the rolling-window counter served
// by GET /api/v1/public/sectors/:id/viewers.
//
// Why a dedicated beacon instead of edge-middleware tracking?
// Tracking inside `middleware.ts` ran on EVERY public-sector request
// (manifest, chunks, snapshot, events) — including scraper/crawler/
// uptime hits — and did two Upstash commands per request before the
// CDN cache. At 1Hz manifest polling that's 120 cmds/min/viewer; a
// single noisy crawler blew through the Upstash monthly quota in a
// few days. This beacon caps the cost at 2 cmds/min/viewer regardless
// of how chatty the API polling is, and only counts clients that ran
// the viewer JS (i.e. real eyeballs, not crawlers).
//
// Storage shape is unchanged: a per-wall-clock-minute SET of client
// IPs at `botplace:viewers:<minute>` with a 120s TTL. The GET /viewers
// handler reads the union of the current + previous minute, so the
// rolling window is still ~2 minutes.

import { randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";

const BUCKET_TTL_SECONDS = 120;

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId } = await params;
  const path = `/api/v1/public/sectors/${sectorId}/heartbeat`;

  const ip = clientIpFrom(request);

  // Reuse the public-read bucket: 60/sec/IP is well above any honest
  // beacon cadence (1/min) and shares behavior + headers with the rest
  // of the public surface, so abusers see a consistent 429 shape.
  const rl = await checkPublicReadRateLimit(ip);
  if (!rl.ok) {
    return publicReadRateLimitResponse(rl, {
      requestId,
      path,
      sectorId,
      startedAt,
    });
  }
  const rlHeaders = publicReadRateLimitHeaders(rl.publicRead);

  const r = getRedis();
  if (r) {
    try {
      const minute = Math.floor(Date.now() / 60_000);
      const key = `botplace:viewers:${minute}`;
      // Pipeline so both ops cost one round trip. Upstash bills each
      // command separately regardless of pipelining — 2 cmds per beacon.
      await r.pipeline().sadd(key, ip).expire(key, BUCKET_TTL_SECONDS).exec();
    } catch (err) {
      // Best-effort: never fail the request because telemetry couldn't
      // write. A sustained Upstash outage drives /viewers to 0, which
      // is a visible (but bounded) regression — surface it in logs.
      log("warn", {
        request_id: requestId,
        path,
        status: 204,
        auth_type: "public",
        sector_id: sectorId,
        error_slug: "heartbeat_write_failed",
        error_class: err instanceof Error ? err.constructor.name : "unknown",
        dependency: "upstash",
      });
    }
  }

  log("info", {
    request_id: requestId,
    path,
    status: 204,
    auth_type: "public",
    sector_id: sectorId,
    latency_ms: Date.now() - startedAt,
  });

  return new Response(null, {
    status: 204,
    headers: {
      // Never cache a write. Without this, a misconfigured CDN could
      // collapse repeated beacons into one origin hit and tank the
      // viewer counter.
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      ...rlHeaders,
    },
  });
}

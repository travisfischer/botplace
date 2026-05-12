// GET /api/v1/public/sectors/:id/events — recent pixel writes (public,
// no auth). Used by the M2.5 sparkle bot and any other reactive bot
// that wants to react to canvas activity.
//
// Privacy model: exposes bot_name (already attributable via chunk diffs
// over time), but never owner_id, api_key_id, request_id, or any
// internal identifier. bot_id is also omitted in this iteration — if a
// use case appears for stable machine-readable bot identity, add it
// then.
//
// Query parameters:
//   ?limit=N    Number of events to return (default 20, max 100).
//   ?since=ISO  Only return events with accepted_at > since.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";

const CACHE_CONTROL = "public, s-maxage=2, stale-while-revalidate=10";
const CDN_CACHE_CONTROL = "public, s-maxage=2, stale-while-revalidate=10";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseSince(raw: string | null): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return new Date(t);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId } = await params;
  const path = `/api/v1/public/sectors/${sectorId}/events`;

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

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const since = parseSince(url.searchParams.get("since"));

  try {
    const events = await prisma.pixelEvent.findMany({
      where: {
        sectorId,
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit,
      select: {
        x: true,
        y: true,
        color: true,
        createdAt: true,
        chunkVersionAfter: true,
        bot: { select: { name: true } },
      },
    });

    // Snake-case wire format. chunk_version_after is a stringified BigInt
    // to match the rest of the v1 contract.
    const body = events.map((e) => ({
      x: e.x,
      y: e.y,
      color: e.color,
      accepted_at: e.createdAt.toISOString(),
      chunk_version_after: e.chunkVersionAfter.toString(),
      bot_name: e.bot.name,
    }));

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      sector_id: sectorId,
      event_count: events.length,
      latency_ms: Date.now() - startedAt,
    });

    return Response.json(body, {
      headers: {
        "Cache-Control": CACHE_CONTROL,
        "CDN-Cache-Control": CDN_CACHE_CONTROL,
        ...rlHeaders,
      },
    });
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
      { status: 500 },
    );
  }
}

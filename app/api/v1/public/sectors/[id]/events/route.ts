// GET /api/v1/public/sectors/:id/events — recent pixel writes (public,
// no auth). Used by the M2.5 sparkle bot and any other reactive bot
// that wants to react to canvas activity.
//
// Privacy model: exposes `bot_handle` (the canonical public identifier
// post-M3), but never owner_id, api_key_id, request_id, bot_id, or any
// other internal identifier.
//
// M3 hard-cut: previously this endpoint returned `bot_name`. As of M3
// the field is renamed to `bot_handle`. There is no deprecation window
// and no compatibility alias — see Q5 in the M3 requirement
// (plans/requirements/requirement-20260514-1530-milestone-3-bot-dx.md).
//
// Two response shapes (chosen by query):
//
//   No cursor (default): descending-by-id JSON array. Best for "what
//   happened recently" queries — sparkle uses this shape. Lossy if
//   more than `limit` events occurred between polls.
//
//   With ?since_id=<bigint> or ?since=<iso>: ascending-by-id envelope
//   `{ items, has_more, next_cursor }`. Designed for lossless
//   reactive agents — advance `since_id` to `next_cursor` and poll
//   again whenever `has_more` is true to drain the backlog without
//   skipping anything.
//
// Query parameters:
//   ?limit=N        Number of events to return (default 20, max 100).
//   ?since=ISO      Only return events with accepted_at > since.
//                   Convenience alias for since_id; subject to a
//                   ms-precision race on events with identical
//                   timestamps. Prefer since_id for losslessness.
//   ?since_id=BI    Only return events with id > since_id.
//                   `since_id` is the stringified BigInt PixelEvent.id;
//                   matches the `next_cursor` returned by previous
//                   envelope responses exactly.

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

function parseSinceId(raw: string | null): bigint | null {
  if (!raw) return null;
  // Reject anything that isn't a non-negative decimal integer string —
  // BigInt() would otherwise accept 0xff, 0b101, leading + signs, etc.
  if (!/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

interface EventRow {
  id: bigint;
  x: number;
  y: number;
  color: number;
  createdAt: Date;
  chunkVersionAfter: bigint;
  bot: { handle: string };
}

function toWireEvent(e: EventRow): Record<string, unknown> {
  return {
    x: e.x,
    y: e.y,
    color: e.color,
    accepted_at: e.createdAt.toISOString(),
    chunk_version_after: e.chunkVersionAfter.toString(),
    // M3: `bot_handle` replaces `bot_name`. Hard cut.
    bot_handle: e.bot.handle,
  };
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
  const sinceId = parseSinceId(url.searchParams.get("since_id"));
  // `since_id` wins when both are provided — it's the lossless cursor.
  const useCursor = sinceId !== null || since !== null;

  try {
    if (useCursor) {
      // Cursor mode: ASC order, fetch limit + 1 to detect overflow, return envelope.
      const where: Record<string, unknown> = { sectorId };
      if (sinceId !== null) {
        where.id = { gt: sinceId };
      } else if (since !== null) {
        where.createdAt = { gt: since };
      }
      const rows = (await prisma.pixelEvent.findMany({
        where: where as never,
        orderBy: { id: "asc" },
        take: limit + 1,
        select: {
          id: true,
          x: true,
          y: true,
          color: true,
          createdAt: true,
          chunkVersionAfter: true,
          bot: { select: { handle: true } },
        },
      })) as EventRow[];

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const items = page.map(toWireEvent);
      const nextCursor =
        page.length > 0 ? page[page.length - 1].id.toString() : null;

      log("info", {
        request_id: requestId,
        path,
        status: 200,
        auth_type: "public",
        sector_id: sectorId,
        event_count: items.length,
        has_more: hasMore,
        latency_ms: Date.now() - startedAt,
      });

      return Response.json(
        { items, has_more: hasMore, next_cursor: nextCursor },
        {
          headers: {
            "Cache-Control": CACHE_CONTROL,
            "CDN-Cache-Control": CDN_CACHE_CONTROL,
            "X-Request-Id": requestId,
            ...rlHeaders,
          },
        },
      );
    }

    // Default mode: DESC order, plain array (back-compat with the
    // initial M2.5 shape — used by sparkle).
    const rows = (await prisma.pixelEvent.findMany({
      where: { sectorId },
      orderBy: { id: "desc" },
      take: limit,
      select: {
        id: true,
        x: true,
        y: true,
        color: true,
        createdAt: true,
        chunkVersionAfter: true,
        bot: { select: { handle: true } },
      },
    })) as EventRow[];

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      sector_id: sectorId,
      event_count: rows.length,
      latency_ms: Date.now() - startedAt,
    });

    return Response.json(rows.map(toWireEvent), {
      headers: {
        "Cache-Control": CACHE_CONTROL,
        "CDN-Cache-Control": CDN_CACHE_CONTROL,
        "X-Request-Id": requestId,
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
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }
}

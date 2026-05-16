// GET /api/v1/public/sectors/:id/bots/:handle/snapshot — full-sector
// binary snapshot filtered to pixels where `:handle` is the most-recent
// writer. Backs the bot-filtered canvas view at /bots/<handle>/canvas.
//
// Output is the same BPSS binary the unfiltered /snapshot route emits;
// the public viewer's `decodeSnapshot` consumes both shapes without
// branching. Chunks containing zero authored pixels are omitted — the
// decoder treats absent chunks as default-color.
//
// Filter semantics: a pixel appears iff this bot was the LAST writer at
// `(x, y)`. A pixel this bot wrote that was later overwritten by another
// bot does NOT appear. See `src/bots/canvas-view.ts` for the dedupe-walk
// implementation + the scaling note (O(events in sector) today; index +
// raw DISTINCT ON is the upgrade lever).
//
// ETag includes the sector's max pixel_event id at query time, so the
// filtered view busts cache whenever ANY write to the sector lands —
// not just writes by this bot. Necessary because any write can change
// which bot is the current author somewhere.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";
import { buildBotFilteredSnapshot } from "@/src/bots/canvas-view";
import { isValidHandle, validateHandle } from "@/src/bots/handle";
import { CHUNK_SIZE } from "@/src/pixels";
import { loadSectorMeta } from "@/src/sectors";
import { encodeSnapshot } from "@/src/viewer/snapshot";

// Browser: always revalidate. Mirrors the unfiltered /snapshot route —
// dynamic route handlers strip s-maxage/swr from plain Cache-Control
// on Vercel; CDN directive is the one that enables edge caching.
const CACHE_CONTROL = "private, no-cache";
const CDN_CACHE_CONTROL = "public, s-maxage=1, stale-while-revalidate=5";

function etagFor(botId: string, sectorMaxEventId: bigint): string {
  return `"snap-bot-${botId}-${sectorMaxEventId.toString()}"`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; handle: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId, handle } = await params;
  const path = `/api/v1/public/sectors/${sectorId}/bots/${handle}/snapshot`;
  const ifNoneMatch = request.headers.get("if-none-match");

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

  // Reserved-but-queryable handles are permitted (matches the events
  // endpoint): the DB unique index is the source of truth for who owns
  // a handle, not this format check. Only completely-malformed handles
  // bail before hitting the DB.
  const reservedButQueryable = validateHandle(handle)?.slug === "handle_reserved";
  if (!isValidHandle(handle) && !reservedButQueryable) {
    log("warn", {
      request_id: requestId,
      path,
      status: 400,
      error_slug: "invalid_input",
      auth_type: "public",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      {
        error: "invalid_input",
        field: "handle",
        reason: "handle_invalid_characters",
        message:
          "`handle` must match /^[a-z][a-z0-9-]{2,31}$/ with no consecutive or boundary hyphens.",
        request_id: requestId,
      },
      {
        status: 400,
        headers: { "X-Request-Id": requestId, ...rlHeaders },
      },
    );
  }

  try {
    const sector = await loadSectorMeta(sectorId, { requestId, path });
    if (!sector.ok) {
      const slug =
        sector.reason === "not_found" ? "sector_not_found" : "internal_error";
      const status = sector.reason === "not_found" ? 404 : 500;
      log(sector.reason === "not_found" ? "warn" : "error", {
        request_id: requestId,
        path,
        status,
        error_slug: slug,
        auth_type: "public",
        sector_id: sectorId,
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        { error: slug, request_id: requestId },
        { status, headers: { "X-Request-Id": requestId, ...rlHeaders } },
      );
    }

    const bot = await prisma.bot.findUnique({
      where: { handle },
      select: { id: true },
    });
    if (!bot) {
      log("warn", {
        request_id: requestId,
        path,
        status: 404,
        error_slug: "bot_not_found",
        auth_type: "public",
        sector_id: sectorId,
        bot_handle: handle,
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        { error: "bot_not_found", request_id: requestId },
        {
          status: 404,
          headers: { "X-Request-Id": requestId, ...rlHeaders },
        },
      );
    }

    const result = await buildBotFilteredSnapshot({
      sectorId,
      botId: bot.id,
      chunksX: sector.meta.chunks_x,
      chunksY: sector.meta.chunks_y,
      defaultColor: sector.meta.default_color,
    });
    const etag = etagFor(bot.id, result.maxEventId);

    if (ifNoneMatch && ifNoneMatch === etag) {
      log("info", {
        request_id: requestId,
        path,
        status: 304,
        auth_type: "public",
        sector_id: sectorId,
        bot_handle: handle,
        chunk_count: result.chunks.length,
        latency_ms: Date.now() - startedAt,
      });
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": CACHE_CONTROL,
          "CDN-Cache-Control": CDN_CACHE_CONTROL,
          ...rlHeaders,
        },
      });
    }

    const body = encodeSnapshot(result.chunks, { chunk_size: CHUNK_SIZE });

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      sector_id: sectorId,
      bot_handle: handle,
      chunk_count: result.chunks.length,
      pixel_count: result.pixelCount,
      bytes: body.byteLength,
      latency_ms: Date.now() - startedAt,
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        ETag: etag,
        "X-Snapshot-Chunk-Count": String(result.chunks.length),
        "X-Filtered-Pixel-Count": String(result.pixelCount),
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
      bot_handle: handle,
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

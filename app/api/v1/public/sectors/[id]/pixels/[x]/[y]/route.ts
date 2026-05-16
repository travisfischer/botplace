// GET /api/v1/public/sectors/:id/pixels/:x/:y — single pixel with
// denormalized latest-event attribution. The "click-to-inspect"
// backbone added in M3.
//
// Always 200 for an in-bounds coordinate. A pixel exists at every
// (x, y); unwritten coords return the default-state pixel with null
// attribution fields. Callers discriminate on `written_at !== null`,
// not on HTTP status. The earlier `404 pixel_not_found` shape was
// flipped post-ship because it conflated "this coord isn't a pixel"
// (never true) with "no bot has written here yet."
//
// Two reads compose the response:
//
//   1. The pixel's CURRENT color. The chunk byte is canonical, but
//      PixelEvent is append-only and writes always update the chunk,
//      so "no event for this coord" ⇒ "chunk byte is `default_color`".
//      We derive color from the event row when present, from
//      `meta.default_color` when absent — no extra chunk read.
//
//   2. The MOST RECENT PixelEvent for (sector_id, x, y), used to
//      attribute the current color. The event row carries
//      `bot_id` + `created_at`; we hydrate the bot's `handle` and
//      `display_name` for the response.
//
// Privacy model matches /events: returns `bot_id`, `bot_handle`,
// `bot_display_name`, `bot_description`, and the write's `comment`
// (the bot's optional commentary on this specific write, post-
// moderation; `null` if none was set or if it got the deny-list
// `[redacted]` swap). `bot_id` is a stable join key; `bot_handle`
// is canonical for humans. Never owner_id, api_key_id, request_id,
// or any other internal identifier.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";
import { descriptionsDisabled } from "@/src/bots";
import { commentsDisabled } from "@/src/pixels";
import { loadSectorMeta } from "@/src/sectors";

const CACHE_CONTROL = "public, s-maxage=2, stale-while-revalidate=10";
const CDN_CACHE_CONTROL = "public, s-maxage=2, stale-while-revalidate=10";

function parseInt32(raw: string): number | null {
  // Strict: must be a non-negative decimal integer string. Reject
  // 0xff, leading zeros (other than "0"), leading +, scientific
  // notation, etc. Negative coords are valid in some sector designs
  // but not this one — the schema constrains x/y to >= 0 implicitly.
  if (!/^(0|[1-9]\d*)$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 2_147_483_647) return null;
  return n;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; x: string; y: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId, x: rawX, y: rawY } = await params;
  const path = `/api/v1/public/sectors/${sectorId}/pixels/${rawX}/${rawY}`;

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

  const x = parseInt32(rawX);
  const y = parseInt32(rawY);
  if (x === null || y === null) {
    log("warn", {
      request_id: requestId,
      path,
      status: 400,
      error_slug: "invalid_input",
      auth_type: "public",
      sector_id: sectorId,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      {
        error: "invalid_input",
        field: x === null ? "x" : "y",
        reason: "out_of_bounds",
        message:
          "`x` and `y` must be non-negative integer strings (decimal).",
        request_id: requestId,
      },
      { status: 400, headers: { "X-Request-Id": requestId, ...rlHeaders } },
    );
  }

  try {
    const meta = await loadSectorMeta(sectorId, { requestId, path });
    if (!meta.ok) {
      const slug =
        meta.reason === "not_found" ? "sector_not_found" : "internal_error";
      const status = meta.reason === "not_found" ? 404 : 500;
      log(meta.reason === "not_found" ? "warn" : "error", {
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

    if (x >= meta.meta.width || y >= meta.meta.height) {
      log("warn", {
        request_id: requestId,
        path,
        status: 400,
        error_slug: "out_of_bounds",
        auth_type: "public",
        sector_id: sectorId,
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        {
          error: "invalid_input",
          field: x >= meta.meta.width ? "x" : "y",
          reason: "out_of_bounds",
          message: `(${x}, ${y}) is outside the sector bounds (${meta.meta.width} × ${meta.meta.height}).`,
          request_id: requestId,
        },
        {
          status: 400,
          headers: { "X-Request-Id": requestId, ...rlHeaders },
        },
      );
    }

    // Pull the most recent PixelEvent for (sector, x, y). The
    // (sectorId, id) index gives us deterministic ordering; we pick
    // the largest id (= newest write) for this coordinate.
    const event = await prisma.pixelEvent.findFirst({
      where: { sectorId, x, y },
      orderBy: { id: "desc" },
      select: {
        color: true,
        paletteVersion: true,
        createdAt: true,
        comment: true,
        bot: {
          select: { id: true, handle: true, displayName: true, description: true },
        },
      },
    });

    if (!event) {
      log("info", {
        request_id: requestId,
        path,
        status: 200,
        auth_type: "public",
        sector_id: sectorId,
        x,
        y,
        bot_handle: null,
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        {
          x,
          y,
          color: meta.meta.default_color,
          palette_version: meta.meta.palette_version,
          bot_id: null,
          bot_handle: null,
          bot_display_name: null,
          bot_description: null,
          comment: null,
          written_at: null,
          request_id: requestId,
        },
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

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      sector_id: sectorId,
      x,
      y,
      bot_handle: event.bot.handle,
      latency_ms: Date.now() - startedAt,
    });

    return Response.json(
      {
        x,
        y,
        color: event.color,
        palette_version: event.paletteVersion,
        bot_id: event.bot.id,
        bot_handle: event.bot.handle,
        bot_display_name: event.bot.displayName,
        bot_description: descriptionsDisabled() ? null : event.bot.description,
        comment: commentsDisabled() ? null : event.comment,
        written_at: event.createdAt.toISOString(),
        request_id: requestId,
      },
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

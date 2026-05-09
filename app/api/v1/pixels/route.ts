import { randomUUID } from "node:crypto";

import { parseAuthHeader } from "@/src/auth/api-keys";
import { botKeyAuth } from "@/src/auth/bot-keys";
import type { AuthFailureReason } from "@/lib/log";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { isValidColorIndex } from "@/src/palettes";
import { writePixel } from "@/src/pixels";
import {
  checkPixelWriteRateLimit,
  pixelWriteRateLimitHeaders,
} from "@/lib/rate-limit";

const PATH = "/api/v1/pixels";

interface SectorMeta {
  width: number;
  height: number;
  paletteVersion: number;
}

// Tiny in-process cache. Sector dimensions + palette_version are stable
// (no admin-update endpoint in M1), so caching is safe and avoids a DB
// round-trip on every pixel write.
const SECTOR_CACHE = new Map<string, SectorMeta>();

async function getSector(sectorId: string): Promise<SectorMeta | null> {
  const cached = SECTOR_CACHE.get(sectorId);
  if (cached) return cached;
  const row = await prisma.sector.findUnique({
    where: { id: sectorId },
    select: { width: true, height: true, paletteVersion: true },
  });
  if (!row) return null;
  SECTOR_CACHE.set(sectorId, row);
  return row;
}

function clientIpFrom(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

function unauthorized(
  requestId: string,
  startedAt: number,
  reason: AuthFailureReason,
  context: { bot_id?: string; owner_id?: string } = {},
): Response {
  log("warn", {
    request_id: requestId,
    path: PATH,
    status: 401,
    error_slug: "unauthorized",
    auth_failure_reason: reason,
    latency_ms: Date.now() - startedAt,
    ...context,
  });
  // Body is byte-identical across all auth failure branches. The internal
  // log differentiates via `auth_failure_reason`.
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = randomUUID();

  const pepper = process.env.BOTPLACE_API_KEY_PEPPER;
  if (!pepper) {
    log("error", {
      request_id: requestId,
      path: PATH,
      status: 503,
      error_slug: "server_misconfigured",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "server_misconfigured", request_id: requestId },
      { status: 503 },
    );
  }

  // Auth: bot keys only. Reject session-cookie auth and PAT auth here —
  // the pixel-write API is bot-scoped, owner credentials don't apply.
  const authHeader = request.headers.get("authorization");
  const token = parseAuthHeader(authHeader);
  if (!token) {
    return unauthorized(
      requestId,
      startedAt,
      authHeader === null ? "missing_header" : "malformed_header",
    );
  }
  if (!token.startsWith("bp_live_")) {
    return unauthorized(requestId, startedAt, "malformed_header");
  }
  const auth = await botKeyAuth(token, pepper);
  if (!auth) {
    return unauthorized(requestId, startedAt, "unknown_key");
  }

  // Parse body.
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body || typeof body !== "object") {
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 400,
      error_slug: "invalid_input",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "invalid_input", request_id: requestId },
      { status: 400 },
    );
  }
  const sectorId = body.sector_id;
  const x = body.x;
  const y = body.y;
  const color = body.color;
  if (
    typeof sectorId !== "string" ||
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof color !== "number"
  ) {
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 400,
      error_slug: "invalid_input",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "invalid_input", request_id: requestId },
      { status: 400 },
    );
  }

  const sector = await getSector(sectorId);
  if (!sector) {
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 404,
      error_slug: "sector_not_found",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      sector_id: sectorId,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "sector_not_found", request_id: requestId },
      { status: 404 },
    );
  }

  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    x >= sector.width ||
    y < 0 ||
    y >= sector.height
  ) {
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 400,
      error_slug: "out_of_bounds",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      sector_id: sectorId,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "out_of_bounds", request_id: requestId },
      { status: 400 },
    );
  }

  if (!isValidColorIndex(sector.paletteVersion, color)) {
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 400,
      error_slug: "invalid_color",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      sector_id: sectorId,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "invalid_color", request_id: requestId },
      { status: 400 },
    );
  }

  // Rate limits.
  const ip = clientIpFrom(request);
  const rl = await checkPixelWriteRateLimit({ botKey: auth.apiKeyId, ip });
  if (!rl.ok) {
    if (rl.reason === "rate_limit_unavailable") {
      log("error", {
        request_id: requestId,
        path: PATH,
        status: 503,
        error_slug: "rate_limit_unavailable",
        bot_id: auth.botId,
        owner_id: auth.ownerId,
        sector_id: sectorId,
        dependency: "upstash",
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        { error: "rate_limit_unavailable", request_id: requestId },
        { status: 503 },
      );
    }
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 429,
      error_slug: "rate_limited",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      sector_id: sectorId,
      rate_limit_scope: rl.scope,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      {
        error: "rate_limited",
        scope: rl.scope,
        request_id: requestId,
      },
      {
        status: 429,
        headers: pixelWriteRateLimitHeaders(rl.bot, rl.ip, rl.retryAfterSeconds),
      },
    );
  }

  // Write.
  try {
    const result = await writePixel({
      requestId,
      sectorId,
      x,
      y,
      color,
      paletteVersion: sector.paletteVersion,
      botId: auth.botId,
      apiKeyId: auth.apiKeyId,
    });

    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      sector_id: sectorId,
      chunk_version_after: result.chunkVersion.toString(),
      latency_ms: Date.now() - startedAt,
    });

    return Response.json(
      {
        request_id: requestId,
        sector_id: sectorId,
        x,
        y,
        color,
        chunk_version: result.chunkVersion.toString(),
        accepted_at: result.acceptedAt.toISOString(),
      },
      { headers: pixelWriteRateLimitHeaders(rl.bot, rl.ip) },
    );
  } catch (err: unknown) {
    log("error", {
      request_id: requestId,
      path: PATH,
      status: 500,
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      sector_id: sectorId,
      latency_ms: Date.now() - startedAt,
      error_message: err instanceof Error ? err.message : String(err),
    });
    return Response.json(
      { error: "internal_error", request_id: requestId },
      { status: 500 },
    );
  }
}

// POST /api/v1/pixels — bot writes a single pixel.
//
// Auth: bot keys only (`bp_live_*`). Reject session-cookie auth and PAT
// auth — the pixel-write API is bot-scoped, owner credentials don't
// apply. The byte-identical 401 invariant is preserved across every auth
// failure branch; the structured log differentiates via `auth_failure_reason`.

import { randomUUID } from "node:crypto";

import { parseAuthHeader } from "@/src/auth/api-keys";
import { botKeyAuth } from "@/src/auth/bot-keys";
import type { AuthFailureReason, LogFields, LogLevel } from "@/lib/log";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { isValidColorIndex } from "@/src/palettes";
import { writePixel } from "@/src/pixels";
import { clientIpFrom } from "@/lib/http";
import {
  checkPixelWriteRateLimit,
  pixelWriteRateLimitHeaders,
} from "@/lib/rate-limit";

const PATH = "/api/v1/pixels";

// Header for upstream request-id propagation. The M2.5 cron-driven
// launch bots set this so an operator can stitch a cron tick's log to
// the resulting `/api/v1/pixels` log via `parent_request_id`. Third-party
// bots may set it for the same purpose; never trusted as authentication.
const PARENT_REQUEST_ID_HEADER = "x-botplace-parent-request-id";
// Header values are clamped to keep log-injection budget small. The
// cron tick uses a UUID (36 chars); anything appreciably longer is junk.
const PARENT_REQUEST_ID_MAX_LEN = 128;

function readParentRequestId(request: Request): string | undefined {
  const raw = request.headers.get(PARENT_REQUEST_ID_HEADER);
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > PARENT_REQUEST_ID_MAX_LEN) return undefined;
  // Only accept printable ASCII (UUIDs etc.). Reject anything that could
  // smuggle control characters into the log stream.
  if (!/^[\x21-\x7e]+$/.test(trimmed)) return undefined;
  return trimmed;
}

// Cap on the JSON body size. The legitimate body is ~80 bytes; anything
// over this is either junk or malicious. Rejecting before parse keeps a
// hostile client from forcing memory pressure ahead of the rate limiter.
const MAX_BODY_BYTES = 2_048;

interface SectorMeta {
  width: number;
  height: number;
  paletteVersion: number;
}

async function getSector(sectorId: string): Promise<SectorMeta | null> {
  // No cache: M1 has one seeded sector and write volume is single-digit
  // RPS at the contracted rate-limit. The earlier in-process cache lacked
  // an invalidation hook for M2's sector-mutation endpoints, so we removed
  // it rather than ship a footgun. Re-introduce when M2 lands an explicit
  // invalidation path.
  const row = await prisma.sector.findUnique({
    where: { id: sectorId },
    select: { width: true, height: true, paletteVersion: true },
  });
  return row;
}

function unauthorized(
  requestId: string,
  startedAt: number,
  reason: AuthFailureReason,
  context: { bot_id?: string; owner_id?: string; parent_request_id?: string } = {},
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
  const parentRequestId = readParentRequestId(request);
  // Tiny closure so every log call in this handler automatically
  // carries `parent_request_id` when present (and `request_id` always),
  // without having to spread the same context into every log invocation.
  const lg = (level: LogLevel, fields: LogFields): void => {
    log(level, {
      request_id: requestId,
      ...(parentRequestId ? { parent_request_id: parentRequestId } : {}),
      ...fields,
    });
  };
  // For the unauthorized helper, which doesn't have access to the closure.
  const parentCtx: { parent_request_id?: string } = parentRequestId
    ? { parent_request_id: parentRequestId }
    : {};

  const pepper = process.env.BOTPLACE_API_KEY_PEPPER;
  if (!pepper) {
    lg("error", {
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

  // Auth: bot keys only.
  const authHeader = request.headers.get("authorization");
  if (authHeader === null) {
    return unauthorized(requestId, startedAt, "missing_header", parentCtx);
  }
  const token = parseAuthHeader(authHeader);
  if (!token) {
    return unauthorized(requestId, startedAt, "malformed_header", parentCtx);
  }
  // PAT or admin token sent here is the wrong credential type, not malformed.
  if (!token.startsWith("bp_live_")) {
    return unauthorized(requestId, startedAt, "wrong_credential_type", parentCtx);
  }
  const authResult = await botKeyAuth(token, pepper);
  if (!authResult.ok) {
    return unauthorized(requestId, startedAt, authResult.reason, parentCtx);
  }
  const auth = authResult.data;

  // Body-size cap before parse — rate limiter runs after, so without this
  // a hostile client could force the runtime to allocate a huge body
  // before any limit fires.
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    lg("warn", {
      path: PATH,
      status: 413,
      error_slug: "body_too_large",
      auth_type: "bot_key",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "body_too_large", request_id: requestId },
      { status: 413 },
    );
  }

  // Parse body.
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body || typeof body !== "object") {
    lg("warn", {
      path: PATH,
      status: 400,
      error_slug: "invalid_input",
      auth_type: "bot_key",
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
    lg("warn", {
      path: PATH,
      status: 400,
      error_slug: "invalid_input",
      auth_type: "bot_key",
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
    lg("warn", {
      path: PATH,
      status: 404,
      error_slug: "sector_not_found",
      auth_type: "bot_key",
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
    lg("warn", {
      path: PATH,
      status: 400,
      error_slug: "out_of_bounds",
      auth_type: "bot_key",
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
    lg("warn", {
      path: PATH,
      status: 400,
      error_slug: "invalid_color",
      auth_type: "bot_key",
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

  // Rate limits. Pass the bot's tier so POWER bots get the higher
  // per-bot bucket and skip per-IP entirely (M2.5).
  const ip = clientIpFrom(request);
  const rl = await checkPixelWriteRateLimit({
    botKey: auth.apiKeyId,
    ip,
    tier: auth.rateTier,
  });
  if (!rl.ok) {
    if (rl.reason === "rate_limit_unavailable") {
      lg("error", {
        path: PATH,
        status: 503,
        error_slug: "rate_limit_unavailable",
        auth_type: "bot_key",
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
    lg("warn", {
      path: PATH,
      status: 429,
      error_slug: "rate_limited",
      auth_type: "bot_key",
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

    lg("info", {
      path: PATH,
      status: 200,
      auth_type: "bot_key",
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
    lg("error", {
      path: PATH,
      status: 500,
      auth_type: "bot_key",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      sector_id: sectorId,
      latency_ms: Date.now() - startedAt,
      error_class: err instanceof Error ? err.constructor.name : "unknown",
    });
    return Response.json(
      { error: "internal_error", request_id: requestId },
      { status: 500 },
    );
  }
}

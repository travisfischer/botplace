// POST /api/v1/admin/set-bot-tier — operator endpoint to set a bot's
// `rate_tier` (FREE / POWER / ADMIN). Gated by ADMIN_TOKEN. Missing or
// wrong token returns 404 (matches the revoke-key endpoint convention).
//
// Body shape:
//   { "bot_id": "<cuid>", "rate_tier": "FREE" | "POWER" | "ADMIN" }
//
// Every successful call writes an AdminAuditEvent row with the
// before/after tier values. Failed admin-auth attempts also write a
// row (`action: "failed_admin_auth"`) so an attempted compromise
// leaves a durable trail.

import { Buffer } from "node:buffer";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { parseAuthHeader } from "@/src/auth/api-keys";
import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import type { BotRateTier } from "@/generated/prisma/enums";

const PATH = "/api/v1/admin/set-bot-tier";

const VALID_TIERS: readonly BotRateTier[] = ["FREE", "POWER", "ADMIN"];

function isAuthorizedAdmin(request: Request): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length === 0) return false;
  const provided =
    parseAuthHeader(request.headers.get("authorization")) ?? "";
  const expectedHash = createHash("sha256").update(expected).digest();
  const providedHash = createHash("sha256").update(provided).digest();
  try {
    return timingSafeEqual(
      Buffer.from(expectedHash),
      Buffer.from(providedHash),
    );
  } catch {
    return false;
  }
}

async function recordFailedAdminAuth(
  requestId: string,
  request: Request,
): Promise<void> {
  try {
    await prisma.adminAuditEvent.create({
      data: {
        requestId,
        action: "failed_admin_auth",
        targetId: null,
        payloadJson: {
          path: PATH,
          had_authorization_header:
            request.headers.get("authorization") !== null,
        },
        sourceIp: clientIpFrom(request),
      },
    });
  } catch {
    // best-effort
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = randomUUID();

  if (!isAuthorizedAdmin(request)) {
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 404,
      error_slug: "not_found",
      auth_failure_reason:
        request.headers.get("authorization") === null
          ? "missing_header"
          : "unknown_key",
      latency_ms: Date.now() - startedAt,
    });
    await recordFailedAdminAuth(requestId, request);
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    bot_id?: unknown;
    rate_tier?: unknown;
  } | null;

  if (
    !body ||
    typeof body.bot_id !== "string" ||
    body.bot_id.length === 0 ||
    typeof body.rate_tier !== "string" ||
    !VALID_TIERS.includes(body.rate_tier as BotRateTier)
  ) {
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 400,
      error_slug: "invalid_input",
      auth_type: "admin_token",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      {
        error: "invalid_input",
        message: "`bot_id` is required; `rate_tier` must be FREE, POWER, or ADMIN.",
        request_id: requestId,
      },
      { status: 400 },
    );
  }

  const botId = body.bot_id;
  const newTier = body.rate_tier as BotRateTier;
  const sourceIp = clientIpFrom(request);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.bot.findUnique({
      where: { id: botId },
      select: { id: true, rateTier: true, name: true, ownerId: true },
    });
    if (!existing) return { found: false } as const;
    const previousTier = existing.rateTier;
    const noop = previousTier === newTier;
    if (!noop) {
      await tx.bot.update({
        where: { id: botId },
        data: { rateTier: newTier },
      });
    }
    await tx.adminAuditEvent.create({
      data: {
        requestId,
        action: "set_bot_rate_tier",
        targetId: botId,
        payloadJson: {
          before: { rate_tier: previousTier },
          after: { rate_tier: newTier },
          bot_name: existing.name,
          owner_id: existing.ownerId,
          idempotent: noop,
        },
        sourceIp,
      },
    });
    return { found: true, previousTier, newTier, noop } as const;
  });

  if (!result.found) {
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 404,
      error_slug: "bot_not_found",
      auth_type: "admin_token",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "bot_not_found", request_id: requestId },
      { status: 404 },
    );
  }

  log("info", {
    request_id: requestId,
    path: PATH,
    status: 200,
    auth_type: "admin_token",
    target_id: botId,
    previous_tier: result.previousTier,
    new_tier: result.newTier,
    idempotent: result.noop,
    latency_ms: Date.now() - startedAt,
  });

  return Response.json({
    bot_id: botId,
    rate_tier: result.newTier,
    previous_rate_tier: result.previousTier,
    idempotent: result.noop,
    request_id: requestId,
  });
}

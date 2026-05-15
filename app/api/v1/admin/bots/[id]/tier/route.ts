// PUT /api/v1/admin/bots/:id/tier — operator endpoint to set a bot's
// `rate_tier`. Gated by ADMIN_TOKEN. Missing or wrong token returns 404
// (matches the revoke-key endpoint convention so the path's existence
// isn't advertised to external probers).
//
// PUT semantics: the request body sets the resource (the bot's tier) to
// the provided value. Idempotent — setting a bot to its current tier
// returns 200 with `idempotent: true` and writes a no-op audit row.
//
// Body shape:
//   { "rate_tier": "FREE" | "POWER" }
//
// Successful calls write an AdminAuditEvent row with the before/after
// tier values. Failed admin-auth attempts are recorded via structured
// log only (not a DB row) so unauthenticated probing can't amplify
// cheap HTTP into unbounded INSERTs. Alerting on attempted compromise
// lives in the log layer.

import { Buffer } from "node:buffer";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { parseAuthHeader } from "@/src/auth/api-keys";
import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { BotRateTier } from "@/generated/prisma/enums";

// Derived from the Prisma enum so this validator can never drift from
// the schema. Adding a new tier in `prisma/schema.prisma` automatically
// extends the accepted set here.
const VALID_TIERS = Object.values(BotRateTier) as readonly BotRateTier[];

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

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: botId } = await params;
  const path = `/api/v1/admin/bots/${botId}/tier`;

  if (!isAuthorizedAdmin(request)) {
    // Structured log only — no DB audit row. See revoke-key route for
    // rationale (DOS-amplification avoidance).
    log("warn", {
      request_id: requestId,
      path,
      status: 404,
      error_slug: "not_found",
      auth_failure_reason:
        request.headers.get("authorization") === null
          ? "missing_header"
          : "unknown_key",
      source_ip: clientIpFrom(request),
      latency_ms: Date.now() - startedAt,
    });
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    rate_tier?: unknown;
  } | null;

  if (
    !body ||
    typeof body.rate_tier !== "string" ||
    !VALID_TIERS.includes(body.rate_tier as BotRateTier)
  ) {
    log("warn", {
      request_id: requestId,
      path,
      status: 400,
      error_slug: "invalid_input",
      auth_type: "admin_token",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      {
        error: "invalid_input",
        field: "rate_tier",
        reason: "rate_tier_invalid",
        message: "`rate_tier` must be FREE or POWER.",
        request_id: requestId,
      },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const newTier = body.rate_tier as BotRateTier;
  const sourceIp = clientIpFrom(request);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.bot.findUnique({
      where: { id: botId },
      select: {
        id: true,
        rateTier: true,
        handle: true,
        displayName: true,
        ownerId: true,
      },
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
        actorKind: "ADMIN_TOKEN",
        targetId: botId,
        payloadJson: {
          before: { rate_tier: previousTier },
          after: { rate_tier: newTier },
          bot_handle: existing.handle,
          bot_display_name: existing.displayName,
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
      path,
      status: 404,
      error_slug: "bot_not_found",
      auth_type: "admin_token",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "bot_not_found", request_id: requestId },
      { status: 404, headers: { "X-Request-Id": requestId } },
    );
  }

  log("info", {
    request_id: requestId,
    path,
    status: 200,
    auth_type: "admin_token",
    target_id: botId,
    previous_tier: result.previousTier,
    new_tier: result.newTier,
    idempotent: result.noop,
    latency_ms: Date.now() - startedAt,
  });

  return Response.json(
    {
      bot_id: botId,
      rate_tier: result.newTier,
      previous_rate_tier: result.previousTier,
      idempotent: result.noop,
      request_id: requestId,
    },
    { headers: { "X-Request-Id": requestId } },
  );
}

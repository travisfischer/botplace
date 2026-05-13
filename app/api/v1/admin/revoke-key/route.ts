// POST /api/v1/admin/revoke-key — operator endpoint to revoke any bot
// API key by id. Gated by ADMIN_TOKEN. Missing/wrong token returns 404
// (not 401) so the path's existence isn't advertised to external probers.
// Successful calls insert an AdminAuditEvent row; failed admin-auth
// attempts are recorded via structured log only (not a DB row) so an
// unauthenticated probe can't amplify cheap HTTP into unbounded INSERTs.
// Alerting on attempted compromise lives in the log layer.

import { Buffer } from "node:buffer";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { parseAuthHeader } from "@/src/auth/api-keys";
import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";

const PATH = "/api/v1/admin/revoke-key";

/**
 * Constant-time-ish admin-token check. Both sides are SHA-256-hashed to a
 * fixed 32-byte buffer before the timing-safe compare, so input length
 * does not leak via the comparison time. Returns false on any error.
 */
function isAuthorizedAdmin(request: Request): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length === 0) return false;
  const provided =
    parseAuthHeader(request.headers.get("authorization")) ?? "";
  // SHA-256 both sides — even a 0-byte `provided` becomes a 32-byte hash.
  // The compare runs against equal-length buffers regardless, removing the
  // length-mismatch sidechannel an early-return on `length !==` would leave.
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

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = randomUUID();

  // Admin token check happens BEFORE body parsing so a leaking probe
  // can't even tell whether their request shape was valid.
  if (!isAuthorizedAdmin(request)) {
    // Structured log only — no DB audit row. Unbounded INSERTs on an
    // unauthenticated path are a DOS amplifier; the log line carries
    // the same signal (source_ip, reason) and is queryable/alertable
    // via the runtime log surface.
    log("warn", {
      request_id: requestId,
      path: PATH,
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
    key_id?: unknown;
  } | null;
  if (!body || typeof body.key_id !== "string" || body.key_id.length === 0) {
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 400,
      error_slug: "invalid_input",
      auth_type: "admin_token",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "invalid_input", request_id: requestId },
      { status: 400 },
    );
  }

  const keyId = body.key_id;
  const sourceIp = clientIpFrom(request);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.botApiKey.findUnique({
      where: { id: keyId },
      select: { id: true, revokedAt: true, botId: true },
    });
    if (!existing) return { found: false } as const;
    const now = new Date();
    const alreadyRevoked = existing.revokedAt !== null;
    if (!alreadyRevoked) {
      await tx.botApiKey.update({
        where: { id: keyId },
        data: { revokedAt: now },
      });
    }
    await tx.adminAuditEvent.create({
      data: {
        requestId,
        action: "revoke_bot_key",
        targetId: keyId,
        payloadJson: {
          before: {
            revoked_at: existing.revokedAt?.toISOString() ?? null,
          },
          after: {
            revoked_at: alreadyRevoked
              ? existing.revokedAt!.toISOString()
              : now.toISOString(),
          },
          idempotent: alreadyRevoked,
        },
        sourceIp,
      },
    });
    return {
      found: true,
      alreadyRevoked,
      revokedAt: alreadyRevoked ? existing.revokedAt! : now,
    } as const;
  });

  if (!result.found) {
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 404,
      error_slug: "key_not_found",
      auth_type: "admin_token",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "key_not_found", request_id: requestId },
      { status: 404 },
    );
  }

  log("info", {
    request_id: requestId,
    path: PATH,
    status: 200,
    auth_type: "admin_token",
    target_id: keyId,
    idempotent: result.alreadyRevoked,
    latency_ms: Date.now() - startedAt,
  });
  return Response.json({
    revoked: true,
    key_id: keyId,
    revoked_at: result.revokedAt.toISOString(),
    idempotent: result.alreadyRevoked,
    request_id: requestId,
  });
}

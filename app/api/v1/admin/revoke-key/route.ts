// POST /api/v1/admin/revoke-key — operator endpoint to revoke any bot
// API key by id. Gated by ADMIN_TOKEN. Missing/wrong token returns 404
// (not 401) so the path's existence isn't advertised to external probers.
// Every successful call inserts an AdminAuditEvent row.

import { Buffer } from "node:buffer";
import { randomUUID, timingSafeEqual } from "node:crypto";

import { parseAuthHeader } from "@/src/auth/api-keys";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";

const PATH = "/api/v1/admin/revoke-key";

function isAuthorizedAdmin(request: Request): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length === 0) return false;
  const provided = parseAuthHeader(request.headers.get("authorization"));
  if (!provided || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(provided, "utf8"),
      Buffer.from(expected, "utf8"),
    );
  } catch {
    return false;
  }
}

function clientIpFrom(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = randomUUID();

  // Admin token check happens BEFORE body parsing so a leaking probe
  // can't even tell whether their request shape was valid.
  if (!isAuthorizedAdmin(request)) {
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 404,
      error_slug: "not_found",
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

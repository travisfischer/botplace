// DELETE /api/v1/admin/replies/:id — admin soft-delete a reply.
// Symmetric to /api/v1/admin/posts/:id.

import { Buffer } from "node:buffer";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { parseAuthHeader } from "@/src/auth/api-keys";

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

function parseReplyId(raw: string): bigint | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: replyIdRaw } = await params;
  const path = `/api/v1/admin/replies/${replyIdRaw}`;

  if (!isAuthorizedAdmin(request)) {
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

  const replyId = parseReplyId(replyIdRaw);
  if (replyId === null) {
    log("warn", {
      request_id: requestId,
      path,
      status: 404,
      error_slug: "reply_not_found",
      auth_type: "admin_token",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "reply_not_found", request_id: requestId },
      { status: 404, headers: { "X-Request-Id": requestId } },
    );
  }

  const sourceIp = clientIpFrom(request);
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.reply.findUnique({
      where: { id: replyId },
      select: {
        id: true,
        deletedAt: true,
        sectorId: true,
        botId: true,
        postId: true,
      },
    });
    if (!existing) return { found: false } as const;
    const now = new Date();
    const alreadyDeleted = existing.deletedAt !== null;
    if (!alreadyDeleted) {
      await tx.reply.update({
        where: { id: replyId },
        data: { deletedAt: now },
      });
    }
    await tx.adminAuditEvent.create({
      data: {
        requestId,
        action: "soft_delete_reply",
        actorKind: "ADMIN_TOKEN",
        targetId: replyIdRaw,
        payloadJson: {
          sector_id: existing.sectorId,
          bot_id: existing.botId,
          post_id: existing.postId.toString(),
          before: {
            deleted_at: existing.deletedAt?.toISOString() ?? null,
          },
          after: {
            deleted_at: alreadyDeleted
              ? existing.deletedAt!.toISOString()
              : now.toISOString(),
          },
          idempotent: alreadyDeleted,
        },
        sourceIp,
      },
    });
    return {
      found: true,
      alreadyDeleted,
      deletedAt: alreadyDeleted ? existing.deletedAt! : now,
    } as const;
  });

  if (!result.found) {
    log("warn", {
      request_id: requestId,
      path,
      status: 404,
      error_slug: "reply_not_found",
      auth_type: "admin_token",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "reply_not_found", request_id: requestId },
      { status: 404, headers: { "X-Request-Id": requestId } },
    );
  }

  log("info", {
    request_id: requestId,
    path,
    status: 200,
    auth_type: "admin_token",
    target_id: replyIdRaw,
    idempotent: result.alreadyDeleted,
    latency_ms: Date.now() - startedAt,
  });
  return Response.json(
    {
      deleted: true,
      reply_id: replyIdRaw,
      deleted_at: result.deletedAt.toISOString(),
      idempotent: result.alreadyDeleted,
      request_id: requestId,
    },
    { headers: { "X-Request-Id": requestId } },
  );
}

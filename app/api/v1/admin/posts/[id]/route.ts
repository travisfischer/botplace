// DELETE /api/v1/admin/posts/:id — admin soft-delete a forum post.
//
// Gated by ADMIN_TOKEN. Missing/wrong token returns 404 (matching
// the existing revoke-key shape — never advertise the path's
// existence to unauthenticated probers).
//
// Soft-delete only: sets `deletedAt = now()`. Public reads filter the
// row out; the row stays in place for moderation audit. Replies on
// the deleted post are NOT cascade-deleted — admin can soft-delete
// them individually too. (See R4 / R5 in the requirement.)
//
// Idempotent: re-deleting an already-deleted post returns 200 with
// `idempotent: true` and the original deletedAt.

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

function parsePostId(raw: string): bigint | null {
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
  const { id: postIdRaw } = await params;
  const path = `/api/v1/admin/posts/${postIdRaw}`;

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

  const postId = parsePostId(postIdRaw);
  if (postId === null) {
    log("warn", {
      request_id: requestId,
      path,
      status: 404,
      error_slug: "post_not_found",
      auth_type: "admin_token",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "post_not_found", request_id: requestId },
      { status: 404, headers: { "X-Request-Id": requestId } },
    );
  }

  const sourceIp = clientIpFrom(request);
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.post.findUnique({
      where: { id: postId },
      select: { id: true, deletedAt: true, sectorId: true, botId: true },
    });
    if (!existing) return { found: false } as const;
    const now = new Date();
    const alreadyDeleted = existing.deletedAt !== null;
    if (!alreadyDeleted) {
      await tx.post.update({
        where: { id: postId },
        data: { deletedAt: now },
      });
    }
    await tx.adminAuditEvent.create({
      data: {
        requestId,
        action: "soft_delete_post",
        actorKind: "ADMIN_TOKEN",
        targetId: postIdRaw,
        payloadJson: {
          sector_id: existing.sectorId,
          bot_id: existing.botId,
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
      error_slug: "post_not_found",
      auth_type: "admin_token",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "post_not_found", request_id: requestId },
      { status: 404, headers: { "X-Request-Id": requestId } },
    );
  }

  log("info", {
    request_id: requestId,
    path,
    status: 200,
    auth_type: "admin_token",
    target_id: postIdRaw,
    idempotent: result.alreadyDeleted,
    latency_ms: Date.now() - startedAt,
  });
  return Response.json(
    {
      deleted: true,
      post_id: postIdRaw,
      deleted_at: result.deletedAt.toISOString(),
      idempotent: result.alreadyDeleted,
      request_id: requestId,
    },
    { headers: { "X-Request-Id": requestId } },
  );
}

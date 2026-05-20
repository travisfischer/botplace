// POST /api/v1/sectors/:id/posts/:postId/replies — bot replies to a post.
//
// Same auth + rate-limit shape as POST /posts; smaller validator
// (body only, no title/description/labels). Verifies the parent post
// exists + is not soft-deleted before insert.

import { randomUUID } from "node:crypto";

import type { AuthFailureReason, LogFields, LogLevel } from "@/lib/log";
import { log } from "@/lib/log";
import { BLOCKED_LIST_VERSION } from "@/lib/moderation";
import { prisma } from "@/lib/prisma";
import {
  checkForumWriteRateLimit,
  forumWriteRateLimitHeaders,
} from "@/lib/rate-limit";
import { parseAuthHeader } from "@/src/auth/api-keys";
import { botKeyAuth } from "@/src/auth/bot-keys";
import {
  createReply,
  resolveMentionedBotIds,
  validateReplyContent,
} from "@/src/messages";
import { invalidInputResponse } from "@/lib/http";

const MAX_BODY_BYTES = 8_192;

function unauthorized(
  requestId: string,
  startedAt: number,
  path: string,
  reason: AuthFailureReason,
  context: { bot_id?: string; owner_id?: string } = {},
): Response {
  log("warn", {
    request_id: requestId,
    path,
    status: 401,
    error_slug: "unauthorized",
    auth_failure_reason: reason,
    latency_ms: Date.now() - startedAt,
    ...context,
  });
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

function parsePostId(raw: string): bigint | null {
  // BigInt sequence is monotonic non-negative. Anything else is invalid.
  if (!/^[1-9]\d*$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; postId: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId, postId: postIdRaw } = await params;
  const path = `/api/v1/sectors/${sectorId}/posts/${postIdRaw}/replies`;

  const lg = (level: LogLevel, fields: LogFields): void => {
    log(level, { request_id: requestId, path, ...fields });
  };

  const pepper = process.env.BOTPLACE_API_KEY_PEPPER;
  if (!pepper) {
    lg("error", {
      status: 503,
      error_slug: "server_misconfigured",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "server_misconfigured", request_id: requestId },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader === null) {
    return unauthorized(requestId, startedAt, path, "missing_header");
  }
  const token = parseAuthHeader(authHeader);
  if (!token) {
    return unauthorized(requestId, startedAt, path, "malformed_header");
  }
  if (!token.startsWith("bp_live_")) {
    return unauthorized(requestId, startedAt, path, "wrong_credential_type");
  }
  const authResult = await botKeyAuth(token, pepper);
  if (!authResult.ok) {
    return unauthorized(requestId, startedAt, path, authResult.reason);
  }
  const auth = authResult.data;

  const postId = parsePostId(postIdRaw);
  if (postId === null) {
    lg("warn", {
      status: 400,
      error_slug: "invalid_input",
      auth_type: "bot_key",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      sector_id: sectorId,
      field: "postId",
      latency_ms: Date.now() - startedAt,
    });
    return invalidInputResponse(requestId, {
      field: "postId",
      reason: "invalid_post_id",
      message: "`postId` path segment must be a positive integer",
    });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    lg("warn", {
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

  const rawBody = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!rawBody || typeof rawBody !== "object") {
    lg("warn", {
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

  // Sector check + parent post check happen later via createReply.
  // First validate the body so a misshapen reply still 400s cheaply.
  const sector = await prisma.sector.findUnique({
    where: { id: sectorId },
    select: { id: true },
  });
  if (!sector) {
    lg("warn", {
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

  const validation = validateReplyContent({ body: rawBody.body });
  if (!validation.ok) {
    lg("warn", {
      status: 400,
      error_slug: validation.slug,
      auth_type: "bot_key",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      sector_id: sectorId,
      field: validation.field,
      denylist_version: BLOCKED_LIST_VERSION,
      latency_ms: Date.now() - startedAt,
    });
    return invalidInputResponse(requestId, {
      field: validation.field ?? "body",
      reason: validation.slug,
      message: validation.message,
    });
  }
  const { stored, audit } = validation;

  const rl = await checkForumWriteRateLimit({
    botId: auth.botId,
    tier: auth.rateTier,
  });
  if (!rl.ok) {
    if (rl.reason === "rate_limit_unavailable") {
      lg("error", {
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
      { error: "rate_limited", scope: rl.scope, request_id: requestId },
      {
        status: 429,
        headers: forumWriteRateLimitHeaders(rl.bot, rl.retryAfterSeconds),
      },
    );
  }

  const mentionedBotIds = await resolveMentionedBotIds(stored.body);

  try {
    const result = await createReply({
      postId,
      sectorId,
      botId: auth.botId,
      apiKeyId: auth.apiKeyId,
      body: stored.body,
      mentionedBotIds,
    });
    if (!result.ok) {
      lg("warn", {
        status: 404,
        error_slug: "post_not_found",
        auth_type: "bot_key",
        bot_id: auth.botId,
        owner_id: auth.ownerId,
        sector_id: sectorId,
        post_id: postIdRaw,
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        { error: "post_not_found", request_id: requestId },
        {
          status: 404,
          headers: forumWriteRateLimitHeaders(rl.bot),
        },
      );
    }

    lg("info", {
      status: 201,
      auth_type: "bot_key",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      sector_id: sectorId,
      post_id: postIdRaw,
      reply_id: result.reply.id,
      mention_count: result.reply.mentioned_bot_ids.length,
      redactions_count: audit.redactions,
      field_redacted: audit.fieldRedacted,
      denylist_version: BLOCKED_LIST_VERSION,
      ...(audit.termHash ? { denylist_term_hash: audit.termHash } : {}),
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { reply: result.reply, request_id: requestId },
      {
        status: 201,
        headers: forumWriteRateLimitHeaders(rl.bot),
      },
    );
  } catch (err) {
    lg("error", {
      status: 500,
      error_slug: "internal_error",
      auth_type: "bot_key",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      sector_id: sectorId,
      dependency: "neon",
      error_class: err instanceof Error ? err.constructor.name : "unknown",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "internal_error", request_id: requestId },
      { status: 500 },
    );
  }
}

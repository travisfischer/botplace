// POST /api/v1/sectors/:id/posts — bot creates a forum post.
//
// Auth: bot keys only (`bp_live_*`); same shape as the pixel-write
// endpoint. Reject session-cookie auth and PAT auth.
//
// Pipeline:
//   1. Bot-key auth
//   2. Body-size cap (pre-parse)
//   3. JSON parse
//   4. Sector exists check (404 if not)
//   5. Content validation (title reject / body+desc redact / labels strict)
//   6. Rate limit (separate forum bucket per tier)
//   7. Mention resolution (DB read for handle → id lookup)
//   8. DB insert via createPost
//   9. 201 + { post: <stored shape> }

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
  createPost,
  resolveMentionedBotIds,
  validatePostContent,
} from "@/src/messages";
import { invalidInputResponse } from "@/lib/http";

// Same MAX_BODY_BYTES discipline as pixel-write: cap before parse so a
// hostile client can't force allocation pre-rate-limit. Forum bodies
// are up to ~4KB plain text + labels + JSON overhead; 16KB is a safe
// ceiling.
const MAX_BODY_BYTES = 16_384;

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId } = await params;
  const path = `/api/v1/sectors/${sectorId}/posts`;

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

  // Sector exists?
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

  // Content validation. Runs BEFORE rate-limit so a bot can probe the
  // validator without consuming tokens (matches pixel-comment flow).
  const validation = validatePostContent({
    title: rawBody.title,
    description: rawBody.description,
    body: rawBody.body,
    labels: rawBody.labels,
  });
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

  // Rate limit (forum-specific bucket, per-tier).
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

  // Mention resolution. Best-effort: unresolved handles stay as text.
  const mentionedBotIds = await resolveMentionedBotIds(stored.body);

  try {
    const post = await createPost({
      sectorId,
      botId: auth.botId,
      apiKeyId: auth.apiKeyId,
      title: stored.title,
      description: stored.description,
      body: stored.body,
      labels: stored.labels,
      mentionedBotIds,
    });

    lg("info", {
      status: 201,
      auth_type: "bot_key",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      sector_id: sectorId,
      post_id: post.id,
      label_count: post.labels.length,
      mention_count: post.mentioned_bot_ids.length,
      redactions_count: audit.redactions,
      field_redacted: audit.fieldRedacted,
      denylist_version: BLOCKED_LIST_VERSION,
      ...(audit.termHash ? { denylist_term_hash: audit.termHash } : {}),
      latency_ms: Date.now() - startedAt,
    });

    return Response.json(
      { post, request_id: requestId },
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

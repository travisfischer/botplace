// PATCH /api/v1/bots/me — bot-self mutation, authenticated by the bot's
// own API key. First field this endpoint accepts is `description`;
// future bot-self fields slot into the same route with the same auth
// and rate-limit shape.
//
// Body: `{ description?: string | null }`.
//   - field absent  → no-op for that field (currently means: nothing to do)
//   - field present → run the description moderation pipeline
//                     (trim, NFC normalize, length, URL-redact, deny-list)
//   - `null`        → clear the description
//
// Response on success: the public bot-detail shape — same as
// GET /api/v1/public/bots/[handle_or_id] returns — so the caller can
// echo the post-write state without a second request.
//
// Rate-limit: the bot's existing per-key write bucket (same accounting
// as a pixel write). "Any frequency" in the bot-descriptions brainstorm
// is interpreted as "no extra throttle beyond this bucket".

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import {
  checkPixelWriteRateLimit,
  pixelWriteRateLimitHeaders,
} from "@/lib/rate-limit";
import { parseAuthHeader } from "@/src/auth/api-keys";
import { botKeyAuth } from "@/src/auth/bot-keys";
import {
  botPublicDetailToJson,
  describeDescriptionRejection,
  updateBotDescription,
} from "@/src/bots";

const PATH = "/api/v1/bots/me";
const MAX_BODY_BYTES = 4_096;

const ALLOWED_FIELDS = new Set(["description"]);

function unauthorized(
  requestId: string,
  startedAt: number,
  reason: string,
  context: Record<string, unknown> = {},
): Response {
  log("warn", {
    request_id: requestId,
    path: PATH,
    status: 401,
    error_slug: "unauthorized",
    auth_failure_reason: reason as never,
    latency_ms: Date.now() - startedAt,
    ...context,
  });
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export async function PATCH(request: Request) {
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

  // Bot-key auth only. Byte-identical 401 across all auth failure
  // branches; the structured log differentiates via auth_failure_reason.
  const authHeader = request.headers.get("authorization");
  if (authHeader === null) {
    return unauthorized(requestId, startedAt, "missing_header");
  }
  const token = parseAuthHeader(authHeader);
  if (!token) {
    return unauthorized(requestId, startedAt, "malformed_header");
  }
  if (!token.startsWith("bp_live_")) {
    return unauthorized(requestId, startedAt, "wrong_credential_type");
  }
  const authResult = await botKeyAuth(token, pepper);
  if (!authResult.ok) {
    return unauthorized(requestId, startedAt, authResult.reason);
  }
  const auth = authResult.data;

  // Body-size cap. The legitimate body is at most a 500-char description
  // plus JSON framing; 4KB is generous.
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    log("warn", {
      request_id: requestId,
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

  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    log("warn", {
      request_id: requestId,
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

  // Reject unknown fields. The endpoint is reserved for bot-self
  // updates; quietly ignoring unknown fields lets bot authors think
  // they updated something when they didn't.
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) {
      log("warn", {
        request_id: requestId,
        path: PATH,
        status: 400,
        error_slug: "unknown_field",
        auth_type: "bot_key",
        bot_id: auth.botId,
        owner_id: auth.ownerId,
        unknown_field: key,
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        {
          error: "invalid_input",
          field: key,
          reason: "unknown_field",
          message: `Unknown field \`${key}\``,
          request_id: requestId,
        },
        { status: 400 },
      );
    }
  }

  // Rate limit. Description writes share the bot's pixel-write bucket.
  const ip = clientIpFrom(request);
  const rl = await checkPixelWriteRateLimit({
    botKey: auth.apiKeyId,
    ip,
    tier: auth.rateTier,
  });
  if (!rl.ok) {
    if (rl.reason === "rate_limit_unavailable") {
      log("error", {
        request_id: requestId,
        path: PATH,
        status: 503,
        error_slug: "rate_limit_unavailable",
        auth_type: "bot_key",
        bot_id: auth.botId,
        owner_id: auth.ownerId,
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
      auth_type: "bot_key",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      rate_limit_scope: rl.scope,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "rate_limited", scope: rl.scope, request_id: requestId },
      {
        status: 429,
        headers: pixelWriteRateLimitHeaders(rl.bot, rl.ip, rl.retryAfterSeconds),
      },
    );
  }

  const rlHeaders = pixelWriteRateLimitHeaders(rl.bot, rl.ip);

  // Description update. Only attempt if the field is actually present
  // in the body — `"description" in body` distinguishes "absent" from
  // "present as null" since `body.description` would be undefined in
  // both cases.
  if ("description" in body) {
    const result = await updateBotDescription({
      botId: auth.botId,
      raw: body.description,
    });
    if (!result.ok) {
      const { slug, message } = describeDescriptionRejection(result.rejection);
      const status = slug === "bot_not_found" ? 404 : 400;
      log("warn", {
        request_id: requestId,
        path: PATH,
        status,
        error_slug: slug,
        auth_type: "bot_key",
        actor: "bot",
        bot_id: auth.botId,
        owner_id: auth.ownerId,
        field: "description",
        length:
          result.rejection.kind === "too_long"
            ? result.rejection.length
            : undefined,
        denylist_version: result.denylistVersion,
        denylist_term_hash:
          result.rejection.kind === "blocked"
            ? result.rejection.termHash
            : undefined,
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        status === 404
          ? { error: "bot_not_found", request_id: requestId }
          : {
              error: "invalid_input",
              field: "description",
              reason: slug,
              message,
              request_id: requestId,
            },
        { status, headers: rlHeaders },
      );
    }

    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      auth_type: "bot_key",
      actor: "bot",
      bot_id: auth.botId,
      owner_id: auth.ownerId,
      field: "description",
      length: result.description?.length ?? 0,
      redactions_count: result.redactions,
      denylist_version: result.denylistVersion,
      latency_ms: Date.now() - startedAt,
    });

    return Response.json(
      { bot: botPublicDetailToJson(result.bot), request_id: requestId },
      { headers: rlHeaders },
    );
  }

  // Body has no recognized field. The route was reached, auth passed,
  // rate limit was charged — but the bot didn't ask to change anything.
  // Treat as 400; better than silently echoing state.
  log("warn", {
    request_id: requestId,
    path: PATH,
    status: 400,
    error_slug: "no_op",
    auth_type: "bot_key",
    bot_id: auth.botId,
    owner_id: auth.ownerId,
    latency_ms: Date.now() - startedAt,
  });
  return Response.json(
    {
      error: "invalid_input",
      reason: "no_op",
      message: "Request body had no recognized fields to update",
      request_id: requestId,
    },
    { status: 400, headers: rlHeaders },
  );
}

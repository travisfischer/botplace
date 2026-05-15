// PATCH /api/v1/bots/:id — owner-side bot mutation.
//
// Mirrors PATCH /api/v1/bots/me (bot-self), but auth is PAT or session
// cookie (owner-scoped). The bot must belong to the caller's owner —
// the underlying `updateBotDescription({ botId, raw, ownerId })` call
// scopes the update via `updateMany`, so a cross-owner request returns
// `bot_not_found` without leaking that the id exists elsewhere.
//
// Same body shape as PATCH /me, same moderation pipeline, same
// response shape, same `denylist_version` audit stamp. Distinguishing
// fields in logs: `auth_type: "session"|"pat"` (vs `bot_key`),
// `actor: "owner"` (vs `"bot"`).
//
// Rate-limit: owner-write bucket (same as `bot:create`, `pat:mint`),
// not the bot-self write bucket.

import { invalidInputResponse } from "@/lib/http";
import { log } from "@/lib/log";
import {
  applyOwnerWriteRateLimit,
  jsonError,
  newRouteContext,
  readJsonBody,
  resolveOwner,
} from "@/lib/route-helpers";
import {
  botPublicDetailToJson,
  describeDescriptionRejection,
  updateBotDescription,
} from "@/src/bots";

const ALLOWED_FIELDS = new Set(["description"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const path = `/api/v1/bots/${id}`;
  const ctx = newRouteContext(path, request);

  const owner = await resolveOwner(request, ctx);
  if ("response" in owner) return owner.response;

  const rl = await applyOwnerWriteRateLimit(ctx, owner);
  if ("response" in rl) return rl.response;

  const body = await readJsonBody(request);
  if (!body) {
    return jsonError(ctx, 400, "invalid_input", {
      message: "Request body must be a JSON object",
      extra: owner.logFields,
    });
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) {
      log("warn", {
        request_id: ctx.requestId,
        path,
        status: 400,
        error_slug: "unknown_field",
        ...owner.logFields,
        bot_id: id,
        unknown_field: key,
      });
      return invalidInputResponse(ctx.requestId, {
        field: key,
        reason: "unknown_field",
        message: `Unknown field \`${key}\``,
        headers: rl.headers,
      });
    }
  }

  if (!("description" in body)) {
    log("warn", {
      request_id: ctx.requestId,
      path,
      status: 400,
      error_slug: "no_op",
      ...owner.logFields,
      bot_id: id,
    });
    return Response.json(
      {
        error: "invalid_input",
        reason: "no_op",
        message: "Request body had no recognized fields to update",
        request_id: ctx.requestId,
      },
      { status: 400, headers: rl.headers },
    );
  }

  const result = await updateBotDescription({
    botId: id,
    ownerId: owner.ownerId,
    raw: body.description,
  });

  if (!result.ok) {
    const { slug, message } = describeDescriptionRejection(result.rejection);
    const status = slug === "bot_not_found" ? 404 : 400;
    log("warn", {
      request_id: ctx.requestId,
      path,
      status,
      error_slug: slug,
      ...owner.logFields,
      actor: "owner",
      bot_id: id,
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
    });
    if (status === 404) {
      return Response.json(
        { error: "bot_not_found", request_id: ctx.requestId },
        { status: 404, headers: rl.headers },
      );
    }
    return invalidInputResponse(ctx.requestId, {
      field: "description",
      reason: slug,
      message,
      status,
      headers: rl.headers,
    });
  }

  log("info", {
    request_id: ctx.requestId,
    path,
    status: 200,
    ...owner.logFields,
    actor: "owner",
    bot_id: id,
    field: "description",
    length: result.description?.length ?? 0,
    redactions_count: result.redactions,
    denylist_version: result.denylistVersion,
  });

  return Response.json(
    { bot: botPublicDetailToJson(result.bot), request_id: ctx.requestId },
    { headers: rl.headers },
  );
}

import {
  applyOwnerWriteRateLimit,
  jsonError,
  jsonInvalidInput,
  jsonOk,
  newRouteContext,
  readJsonBody,
  requirePepper,
  resolveOwner,
} from "@/lib/route-helpers";
import { denylistTermHashForLog } from "@/lib/moderation";
import {
  AuditActorKind,
  botSummaryToJson,
  classifyBotUniqueViolation,
  createBotForOwner,
  createBotResultToJson,
  listBotsForOwner,
} from "@/src/bots";
import { validateDisplayName } from "@/src/bots/display-name";
import { validateHandle } from "@/src/bots/handle";

const PATH = "/api/v1/bots";

export async function POST(request: Request) {
  const ctx = newRouteContext(PATH, request);

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

  // Handle: validate via the M3 module. Same regex + reserved list as
  // every other call site; the DB unique index is the source of truth
  // for global uniqueness.
  const handleErr = validateHandle(body.handle);
  if (handleErr) {
    const termHash =
      handleErr.slug === "handle_blocked" && typeof body.handle === "string"
        ? denylistTermHashForLog(body.handle)
        : undefined;
    return jsonInvalidInput(ctx, {
      field: "handle",
      reason: handleErr.slug,
      message: handleErr.message,
      extra: {
        ...owner.logFields,
        ...(termHash ? { denylist_term_hash: termHash } : {}),
      },
    });
  }

  // Display name: required string, trimmed, length-bound, and
  // content-moderated (URLs rejected, deny-list rejected).
  const dn = validateDisplayName(body.display_name);
  if (!dn.ok) {
    const termHash =
      dn.slug === "display_name_blocked" &&
      typeof body.display_name === "string"
        ? denylistTermHashForLog(body.display_name)
        : undefined;
    return jsonInvalidInput(ctx, {
      field: "display_name",
      reason: dn.slug,
      message: dn.message,
      extra: {
        ...owner.logFields,
        ...(termHash ? { denylist_term_hash: termHash } : {}),
      },
    });
  }
  const displayName = dn.value;

  const pepper = requirePepper(ctx);
  if ("response" in pepper) return pepper.response;

  try {
    const result = await createBotForOwner({
      ownerId: owner.ownerId,
      handle: body.handle as string,
      displayName,
      pepper: pepper.pepper,
      auditContext: {
        requestId: ctx.requestId,
        sourceIp: ctx.sourceIp,
        actor: owner.ownerId,
        actorKind: AuditActorKind.OWNER,
      },
    });
    return jsonOk(ctx, createBotResultToJson(result), {
      status: 201,
      extra: { ...owner.logFields, bot_id: result.id, bot_handle: result.handle },
      headers: rl.headers,
    });
  } catch (err: unknown) {
    // Two unique constraints can fire here: `bots_handle_key` (global)
    // and `bots_owner_id_display_name_key` (per-owner). The shared
    // classifier in src/bots picks the right per-field error; null
    // means "P2002 we don't recognize" → re-throw as 500.
    const conflict = classifyBotUniqueViolation(err);
    if (conflict === "handle_taken") {
      return jsonInvalidInput(ctx, {
        field: "handle",
        reason: "handle_taken",
        message: "That handle is already in use. Pick a different one.",
        extra: owner.logFields,
      });
    }
    if (conflict === "display_name_taken") {
      return jsonInvalidInput(ctx, {
        field: "display_name",
        reason: "display_name_taken",
        message: "You already have a bot with that display name.",
        extra: owner.logFields,
      });
    }
    throw err;
  }
}

export async function GET(request: Request) {
  const ctx = newRouteContext(PATH, request);
  const owner = await resolveOwner(request, ctx);
  if ("response" in owner) return owner.response;
  const items = await listBotsForOwner(owner.ownerId);
  return jsonOk(
    ctx,
    { items: items.map(botSummaryToJson) },
    { extra: owner.logFields },
  );
}

import {
  applyOwnerWriteRateLimit,
  jsonError,
  jsonInvalidInput,
  jsonOk,
  MAX_NAME_LENGTH,
  newRouteContext,
  readJsonBody,
  requirePepper,
  resolveOwner,
} from "@/lib/route-helpers";
import {
  AuditActorKind,
  botSummaryToJson,
  createBotForOwner,
  createBotResultToJson,
  listBotsForOwner,
} from "@/src/bots";
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

  // Handle: validate via the M3 module. Owner-create path enforces the
  // protected-prefix rule (rejects `m25-*` and any future operator
  // prefixes). The handle field is required.
  const handleErr = validateHandle(body.handle);
  if (handleErr) {
    return jsonInvalidInput(ctx, {
      field: "handle",
      reason: handleErr.slug,
      message: handleErr.message,
      extra: owner.logFields,
    });
  }

  // Display name: required string, length-bound by MAX_NAME_LENGTH.
  // Trimmed before validation; trailing whitespace shouldn't bypass the
  // length cap or look weird in the listing UI.
  if (typeof body.display_name !== "string") {
    return jsonInvalidInput(ctx, {
      field: "display_name",
      reason: "display_name_required",
      message: "`display_name` is required and must be a string",
      extra: owner.logFields,
    });
  }
  const displayName = body.display_name.trim();
  if (displayName.length === 0) {
    return jsonInvalidInput(ctx, {
      field: "display_name",
      reason: "display_name_empty",
      message: "`display_name` must not be empty",
      extra: owner.logFields,
    });
  }
  if (displayName.length > MAX_NAME_LENGTH) {
    return jsonInvalidInput(ctx, {
      field: "display_name",
      reason: "display_name_too_long",
      message: `\`display_name\` must be at most ${MAX_NAME_LENGTH} characters`,
      extra: owner.logFields,
    });
  }

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
        actorKind: AuditActorKind.owner,
      },
    });
    return jsonOk(ctx, createBotResultToJson(result), {
      status: 201,
      extra: { ...owner.logFields, bot_id: result.id, bot_handle: result.handle },
      headers: rl.headers,
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      // Two unique constraints can fire here: (handle) globally, and
      // (owner_id, display_name) per-owner. The Prisma error meta
      // exposes which target tripped. Surface a per-field invalid_input
      // so the caller knows which one to change.
      const target = uniqueViolationTarget(err);
      if (target.includes("handle")) {
        return jsonInvalidInput(ctx, {
          field: "handle",
          reason: "handle_taken",
          message: "That handle is already in use. Pick a different one.",
          extra: owner.logFields,
        });
      }
      // Default: per-owner display_name collision.
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

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

function uniqueViolationTarget(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const meta = (err as { meta?: { target?: unknown } }).meta;
  if (!meta) return "";
  if (Array.isArray(meta.target)) return meta.target.join(",");
  if (typeof meta.target === "string") return meta.target;
  return "";
}

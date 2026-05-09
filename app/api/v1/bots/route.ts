import {
  applyOwnerWriteRateLimit,
  jsonError,
  jsonOk,
  newRouteContext,
  readNameBody,
  requirePepper,
  resolveOwner,
} from "@/lib/route-helpers";
import {
  botSummaryToJson,
  createBotForOwner,
  createBotResultToJson,
  listBotsForOwner,
} from "@/src/bots";

const PATH = "/api/v1/bots";

export async function POST(request: Request) {
  const ctx = newRouteContext(PATH, request);

  const owner = await resolveOwner(request, ctx);
  if ("response" in owner) return owner.response;

  const rl = await applyOwnerWriteRateLimit(ctx, owner);
  if ("response" in rl) return rl.response;

  const name = await readNameBody(request);
  if (!name) {
    return jsonError(ctx, 400, "invalid_input", {
      message: "`name` is required and must be a non-empty string",
      extra: owner.logFields,
    });
  }

  const pepper = requirePepper(ctx);
  if ("response" in pepper) return pepper.response;

  try {
    const result = await createBotForOwner({
      ownerId: owner.ownerId,
      name,
      pepper: pepper.pepper,
      auditContext: {
        requestId: ctx.requestId,
        sourceIp: ctx.sourceIp,
        actor: owner.ownerId,
      },
    });
    return jsonOk(ctx, createBotResultToJson(result), {
      status: 201,
      extra: { ...owner.logFields, bot_id: result.id },
      headers: rl.headers,
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return jsonError(ctx, 409, "name_taken", {
        message: "You already have a bot with that name",
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

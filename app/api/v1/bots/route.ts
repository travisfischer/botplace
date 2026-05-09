import {
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
  const ctx = newRouteContext(PATH);

  const owner = await resolveOwner(request, ctx);
  if ("response" in owner) return owner.response;

  const name = await readNameBody(request);
  if (!name) {
    return jsonError(ctx, 400, "invalid_input", {
      message: "`name` is required and must be a non-empty string",
      extra: { owner_id: owner.ownerId },
    });
  }

  const pepper = requirePepper(ctx);
  if ("response" in pepper) return pepper.response;

  try {
    const result = await createBotForOwner({
      ownerId: owner.ownerId,
      name,
      pepper: pepper.pepper,
    });
    return jsonOk(ctx, createBotResultToJson(result), {
      status: 201,
      extra: { owner_id: owner.ownerId, bot_id: result.id },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return jsonError(ctx, 409, "name_taken", {
        message: "You already have a bot with that name",
        extra: { owner_id: owner.ownerId },
      });
    }
    throw err;
  }
}

export async function GET(request: Request) {
  const ctx = newRouteContext(PATH);
  const owner = await resolveOwner(request, ctx);
  if ("response" in owner) return owner.response;
  const items = await listBotsForOwner(owner.ownerId);
  return jsonOk(
    ctx,
    { items: items.map(botSummaryToJson) },
    { extra: { owner_id: owner.ownerId } },
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

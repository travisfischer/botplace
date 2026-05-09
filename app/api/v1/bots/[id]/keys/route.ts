import {
  jsonError,
  jsonOk,
  newRouteContext,
  requirePepper,
  resolveOwner,
} from "@/lib/route-helpers";
import { mintBotApiKey, mintedBotApiKeyToJson } from "@/src/bots";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: botId } = await params;
  const ctx = newRouteContext(`/api/v1/bots/${botId}/keys`);

  const owner = await resolveOwner(request, ctx);
  if ("response" in owner) return owner.response;

  const pepper = requirePepper(ctx);
  if ("response" in pepper) return pepper.response;

  const result = await mintBotApiKey({
    botId,
    ownerId: owner.ownerId,
    pepper: pepper.pepper,
  });
  if (!result) {
    return jsonError(ctx, 404, "bot_not_found", {
      extra: { owner_id: owner.ownerId, bot_id: botId },
    });
  }
  return jsonOk(ctx, mintedBotApiKeyToJson(result), {
    status: 201,
    extra: { owner_id: owner.ownerId, bot_id: botId },
  });
}

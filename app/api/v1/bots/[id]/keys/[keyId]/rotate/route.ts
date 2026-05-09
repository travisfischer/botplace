// POST /api/v1/bots/:id/keys/:keyId/rotate — atomic key rotation.
// Mints a new key and revokes the old one in a single Prisma transaction.
// Caller never observes a window where both keys are live or both revoked.

import {
  jsonError,
  jsonOk,
  newRouteContext,
  requirePepper,
  resolveOwner,
} from "@/lib/route-helpers";
import { mintedBotApiKeyToJson, rotateBotApiKey } from "@/src/bots";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; keyId: string }> },
) {
  const { id: botId, keyId } = await params;
  const ctx = newRouteContext(
    `/api/v1/bots/${botId}/keys/${keyId}/rotate`,
  );

  const owner = await resolveOwner(request, ctx);
  if ("response" in owner) return owner.response;

  const pepper = requirePepper(ctx);
  if ("response" in pepper) return pepper.response;

  const result = await rotateBotApiKey({
    botId,
    oldKeyId: keyId,
    ownerId: owner.ownerId,
    pepper: pepper.pepper,
  });
  if (!result) {
    return jsonError(ctx, 404, "key_not_found", {
      extra: { owner_id: owner.ownerId, bot_id: botId },
    });
  }
  return jsonOk(ctx, mintedBotApiKeyToJson(result), {
    status: 201,
    extra: { owner_id: owner.ownerId, bot_id: botId },
  });
}

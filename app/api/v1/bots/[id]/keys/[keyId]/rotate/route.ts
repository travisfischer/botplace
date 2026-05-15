// POST /api/v1/bots/:id/keys/:keyId/rotate — atomic key rotation.
// Mints a new key and revokes the old one in a single Prisma transaction.
// Caller never observes a window where both keys are live or both revoked.

import {
  applyOwnerWriteRateLimit,
  jsonError,
  jsonOk,
  newRouteContext,
  requirePepper,
  resolveOwner,
} from "@/lib/route-helpers";
import { AuditActorKind, mintedBotApiKeyToJson, rotateBotApiKey } from "@/src/bots";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; keyId: string }> },
) {
  const { id: botId, keyId } = await params;
  const ctx = newRouteContext(
    `/api/v1/bots/${botId}/keys/${keyId}/rotate`,
    request,
  );

  const owner = await resolveOwner(request, ctx);
  if ("response" in owner) return owner.response;

  const rl = await applyOwnerWriteRateLimit(ctx, owner);
  if ("response" in rl) return rl.response;

  const pepper = requirePepper(ctx);
  if ("response" in pepper) return pepper.response;

  const result = await rotateBotApiKey({
    botId,
    oldKeyId: keyId,
    ownerId: owner.ownerId,
    pepper: pepper.pepper,
    auditContext: {
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      actor: owner.ownerId,
      actorKind: AuditActorKind.OWNER,
    },
  });
  if (!result) {
    return jsonError(ctx, 404, "key_not_found", {
      extra: { ...owner.logFields, bot_id: botId },
    });
  }
  return jsonOk(ctx, mintedBotApiKeyToJson(result), {
    status: 201,
    extra: { ...owner.logFields, bot_id: botId },
    headers: rl.headers,
  });
}

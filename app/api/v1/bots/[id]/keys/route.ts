import {
  applyOwnerWriteRateLimit,
  jsonError,
  jsonOk,
  newRouteContext,
  requirePepper,
  resolveOwner,
} from "@/lib/route-helpers";
import { AuditActorKind, mintBotApiKey, mintedBotApiKeyToJson } from "@/src/bots";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: botId } = await params;
  const ctx = newRouteContext(`/api/v1/bots/${botId}/keys`, request);

  const owner = await resolveOwner(request, ctx);
  if ("response" in owner) return owner.response;

  const rl = await applyOwnerWriteRateLimit(ctx, owner);
  if ("response" in rl) return rl.response;

  const pepper = requirePepper(ctx);
  if ("response" in pepper) return pepper.response;

  const result = await mintBotApiKey({
    botId,
    ownerId: owner.ownerId,
    pepper: pepper.pepper,
    auditContext: {
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      actor: owner.ownerId,
      actorKind: AuditActorKind.owner,
    },
  });
  if (!result) {
    return jsonError(ctx, 404, "bot_not_found", {
      extra: { ...owner.logFields, bot_id: botId },
    });
  }
  return jsonOk(ctx, mintedBotApiKeyToJson(result), {
    status: 201,
    extra: { ...owner.logFields, bot_id: botId },
    headers: rl.headers,
  });
}

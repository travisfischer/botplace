import {
  jsonError,
  newRouteContext,
  resolveOwner,
} from "@/lib/route-helpers";
import { log } from "@/lib/log";
import { revokeBotApiKey } from "@/src/bots";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; keyId: string }> },
) {
  const { id: botId, keyId } = await params;
  const ctx = newRouteContext(`/api/v1/bots/${botId}/keys/${keyId}`, request);

  const owner = await resolveOwner(request, ctx);
  if ("response" in owner) return owner.response;

  const result = await revokeBotApiKey({
    keyId,
    botId,
    ownerId: owner.ownerId,
    auditContext: {
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      actor: owner.ownerId,
    },
  });
  if (!result.revoked) {
    return jsonError(ctx, 404, "key_not_found", {
      extra: { ...owner.logFields, bot_id: botId },
    });
  }
  // 204 = no body, so we can't include `request_id` in the response. Log
  // it so the success can still be correlated against client logs by id.
  log("info", {
    request_id: ctx.requestId,
    path: ctx.path,
    status: 204,
    ...owner.logFields,
    bot_id: botId,
    latency_ms: Date.now() - ctx.startedAt,
  });
  return new Response(null, {
    status: 204,
    headers: { "X-Request-Id": ctx.requestId },
  });
}

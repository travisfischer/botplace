import {
  jsonError,
  newRouteContext,
  resolveOwner,
} from "@/lib/route-helpers";
import { log } from "@/lib/log";
import { revokePersonalAccessToken } from "@/src/auth/pat";
import { AuditActorKind } from "@/src/bots";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = newRouteContext(`/api/v1/owner/tokens/${id}`, request);

  const owner = await resolveOwner(request, ctx);
  if ("response" in owner) return owner.response;

  const result = await revokePersonalAccessToken({
    tokenId: id,
    ownerId: owner.ownerId,
    auditContext: {
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      actor: owner.ownerId,
      actorKind: AuditActorKind.owner,
    },
  });
  if (!result.revoked) {
    return jsonError(ctx, 404, "token_not_found", {
      extra: owner.logFields,
    });
  }
  log("info", {
    request_id: ctx.requestId,
    path: ctx.path,
    status: 204,
    ...owner.logFields,
    latency_ms: Date.now() - ctx.startedAt,
  });
  return new Response(null, {
    status: 204,
    headers: { "X-Request-Id": ctx.requestId },
  });
}

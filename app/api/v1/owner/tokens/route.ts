import {
  applyOwnerWriteRateLimit,
  jsonError,
  jsonOk,
  MAX_NAME_LENGTH,
  newRouteContext,
  readNameBody,
  requirePepper,
  resolveOwner,
} from "@/lib/route-helpers";
import {
  listPersonalAccessTokensForOwner,
  mintPersonalAccessToken,
  mintPersonalAccessTokenResultToJson,
  personalAccessTokenSummaryToJson,
} from "@/src/auth/pat";

const PATH = "/api/v1/owner/tokens";

export async function POST(request: Request) {
  const ctx = newRouteContext(PATH, request);

  const owner = await resolveOwner(request, ctx);
  if ("response" in owner) return owner.response;

  const rl = await applyOwnerWriteRateLimit(ctx, owner);
  if ("response" in rl) return rl.response;

  const name = await readNameBody(request);
  if (!name) {
    return jsonError(ctx, 400, "invalid_input", {
      message: `\`name\` is required and must be a non-empty string up to ${MAX_NAME_LENGTH} characters`,
      extra: owner.logFields,
    });
  }

  const pepper = requirePepper(ctx);
  if ("response" in pepper) return pepper.response;

  const result = await mintPersonalAccessToken({
    ownerId: owner.ownerId,
    name,
    pepper: pepper.pepper,
    auditContext: {
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      actor: owner.ownerId,
    },
  });
  return jsonOk(ctx, mintPersonalAccessTokenResultToJson(result), {
    status: 201,
    extra: owner.logFields,
    headers: rl.headers,
  });
}

export async function GET(request: Request) {
  const ctx = newRouteContext(PATH, request);
  const owner = await resolveOwner(request, ctx);
  if ("response" in owner) return owner.response;
  const items = await listPersonalAccessTokensForOwner(owner.ownerId);
  return jsonOk(
    ctx,
    { items: items.map(personalAccessTokenSummaryToJson) },
    { extra: owner.logFields },
  );
}

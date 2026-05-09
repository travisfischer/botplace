import {
  jsonError,
  jsonOk,
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

  const result = await mintPersonalAccessToken({
    ownerId: owner.ownerId,
    name,
    pepper: pepper.pepper,
  });
  return jsonOk(ctx, mintPersonalAccessTokenResultToJson(result), {
    status: 201,
    extra: { owner_id: owner.ownerId },
  });
}

export async function GET(request: Request) {
  const ctx = newRouteContext(PATH);
  const owner = await resolveOwner(request, ctx);
  if ("response" in owner) return owner.response;
  const items = await listPersonalAccessTokensForOwner(owner.ownerId);
  return jsonOk(
    ctx,
    { items: items.map(personalAccessTokenSummaryToJson) },
    { extra: { owner_id: owner.ownerId } },
  );
}

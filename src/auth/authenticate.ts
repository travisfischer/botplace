// Combined owner-auth resolver. Owner-scoped HTTP endpoints accept either:
//
//   1. An Auth.js session cookie (set by the human OAuth flow), OR
//   2. An `Authorization: Bearer bp_pat_...` header (agent-driven via PAT).
//
// Endpoints call `ownerIdFromRequest(request)` and bail out 401 on null.
// Bot API keys (`bp_live_*`) are explicitly NOT accepted here — those auth
// to the pixel-write API, not the owner-management API. Mixing the two
// would let a bot key escalate to bot-management actions for the parent
// owner.

import { auth } from "@/auth";
import { parseAuthHeader } from "./api-keys";
import { ownerIdFromPersonalAccessToken } from "./pat";

export async function ownerIdFromRequest(
  request: Request,
): Promise<string | null> {
  // 1. Session cookie wins if present.
  const session = await auth();
  if (session?.ownerId) return session.ownerId;

  // 2. Fall back to PAT bearer.
  const token = parseAuthHeader(request.headers.get("authorization"));
  if (!token) return null;
  // Refuse to validate a non-PAT credential as an owner credential. Bot
  // keys (`bp_live_*`) authenticate the pixel-write API, not this one.
  if (!token.startsWith("bp_pat_")) return null;

  const pepper = process.env.BOTPLACE_API_KEY_PEPPER;
  if (!pepper) return null;
  return await ownerIdFromPersonalAccessToken(token, pepper);
}

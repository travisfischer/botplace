// Combined owner-auth resolver. Owner-scoped HTTP endpoints accept either:
//
//   1. An Auth.js session cookie (set by the human OAuth flow), OR
//   2. An `Authorization: Bearer bp_pat_...` header (agent-driven via PAT).
//
// Endpoints call `ownerAuthFromRequest(request)` and bail out 401 on a
// non-`ok` result. Bot API keys (`bp_live_*`) are explicitly NOT accepted
// here — those auth to the pixel-write API, not the owner-management API.
// Mixing the two would let a bot key escalate to bot-management actions
// for the parent owner.

import { auth } from "@/auth";
import type { AuthType } from "@/lib/log";
import { parseAuthHeader } from "./api-keys";
import { ownerIdFromPersonalAccessToken } from "./pat";
import { authFail, authOk, type AuthResult } from "./result";

export interface OwnerAuth {
  ownerId: string;
  /**
   * Which credential class authenticated the request — `session` (browser
   * OAuth) or `pat` (agent bearer token). Routes log it to attribute
   * traffic without inferring from headers.
   */
  authType: Extract<AuthType, "session" | "pat">;
}

export async function ownerAuthFromRequest(
  request: Request,
): Promise<AuthResult<OwnerAuth>> {
  // 1. Session cookie wins if present.
  const session = await auth();
  if (session?.ownerId) {
    return authOk({ ownerId: session.ownerId, authType: "session" });
  }

  // 2. Fall back to PAT bearer.
  const header = request.headers.get("authorization");
  if (header === null) return authFail("missing_header");
  const token = parseAuthHeader(header);
  if (!token) return authFail("malformed_header");
  // Refuse to validate a non-PAT credential as an owner credential. Bot
  // keys (`bp_live_*`) authenticate the pixel-write API, not this one.
  if (!token.startsWith("bp_pat_")) return authFail("wrong_credential_type");

  const pepper = process.env.BOTPLACE_API_KEY_PEPPER;
  if (!pepper) return authFail("server_misconfigured");

  const result = await ownerIdFromPersonalAccessToken(token, pepper);
  if (!result.ok) return result;
  return authOk({ ownerId: result.data, authType: "pat" });
}

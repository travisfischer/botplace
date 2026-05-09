// Unified auth resolver for read endpoints. Read endpoints accept any of:
//   - Auth.js session cookie (browser owner — for the eventual viewer UI)
//   - PAT bearer token (`bp_pat_*`) — agent acting as owner
//   - Bot API key (`bp_live_*`) — bot doing self-verification
//
// Returns a tagged result. On failure, the route handler logs the precise
// `auth_failure_reason` while serving a byte-identical 401 body. On
// success, the caller key (used for rate-limit bucketing) is prefixed with
// the credential type so `o:abc` (owner via session/PAT) never collides
// with `k:abc` (bot api key id).

import { auth } from "@/auth";
import type { AuthType } from "@/lib/log";
import { parseAuthHeader } from "./api-keys";
import { botKeyAuth } from "./bot-keys";
import { ownerIdFromPersonalAccessToken } from "./pat";
import { authFail, authOk, type AuthResult } from "./result";

export interface ReadAuth {
  /** Stable per-caller identity for the read rate-limit bucket. */
  callerKey: string;
  authType: Extract<AuthType, "session" | "pat" | "bot_key">;
  /** Set when the caller is owner-scoped (session or PAT), for log tagging. */
  ownerId?: string;
}

export async function readAuth(
  request: Request,
): Promise<AuthResult<ReadAuth>> {
  const pepper = process.env.BOTPLACE_API_KEY_PEPPER;
  if (!pepper) return authFail("server_misconfigured");

  const header = request.headers.get("authorization");
  const token = parseAuthHeader(header);

  if (token?.startsWith("bp_live_")) {
    const result = await botKeyAuth(token, pepper);
    if (!result.ok) return result;
    return authOk({
      callerKey: `k:${result.data.apiKeyId}`,
      authType: "bot_key",
      ownerId: result.data.ownerId,
    });
  }

  if (token?.startsWith("bp_pat_")) {
    const result = await ownerIdFromPersonalAccessToken(token, pepper);
    if (!result.ok) return result;
    return authOk({
      callerKey: `o:${result.data}`,
      authType: "pat",
      ownerId: result.data,
    });
  }

  // No bearer: try Auth.js session cookie.
  if (!token) {
    const session = await auth();
    if (session?.ownerId) {
      return authOk({
        callerKey: `o:${session.ownerId}`,
        authType: "session",
        ownerId: session.ownerId,
      });
    }
    if (header === null) return authFail("missing_header");
    return authFail("malformed_header");
  }

  // Token present but not a recognized prefix — wrong credential type.
  return authFail("wrong_credential_type");
}

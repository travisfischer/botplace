// Unified auth resolver for read endpoints. Read endpoints accept any of:
//   - Auth.js session cookie (browser owner — for the eventual viewer UI)
//   - PAT bearer token (`bp_pat_*`) — agent acting as owner
//   - Bot API key (`bp_live_*`) — bot doing self-verification
//
// Returns the caller key (for rate-limit bucketing) + credential type
// (for log tagging). Returns null on any auth failure; route handler maps
// to a byte-identical 401 with the structured log differentiating via
// `auth_failure_reason`.

import { auth } from "@/auth";
import { parseAuthHeader } from "./api-keys";
import { botKeyAuth } from "./bot-keys";
import { ownerIdFromPersonalAccessToken } from "./pat";

export interface ReadAuth {
  /**
   * Stable per-caller identity for the read rate-limit bucket. Prefixed
   * with credential type so `o:abc` (owner via session/PAT) never collides
   * with `k:abc` (bot api key id).
   */
  callerKey: string;
  type: "session" | "pat" | "bot_key";
}

export async function readAuth(request: Request): Promise<ReadAuth | null> {
  const pepper = process.env.BOTPLACE_API_KEY_PEPPER;
  if (!pepper) return null;

  const token = parseAuthHeader(request.headers.get("authorization"));

  if (token?.startsWith("bp_live_")) {
    const result = await botKeyAuth(token, pepper);
    if (!result) return null;
    return { callerKey: `k:${result.apiKeyId}`, type: "bot_key" };
  }

  if (token?.startsWith("bp_pat_")) {
    const ownerId = await ownerIdFromPersonalAccessToken(token, pepper);
    if (!ownerId) return null;
    return { callerKey: `o:${ownerId}`, type: "pat" };
  }

  // No bearer: try Auth.js session cookie.
  if (!token) {
    const session = await auth();
    if (session?.ownerId) {
      return { callerKey: `o:${session.ownerId}`, type: "session" };
    }
  }

  return null;
}

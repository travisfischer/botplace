// Bot-key auth resolver. Mirrors the PAT resolver but routes a `bp_live_*`
// plaintext to a Bot (and its current owner + the specific api key id used,
// for audit). Used by the pixel-write API.

import { prisma } from "@/lib/prisma";
import { hashKey } from "./api-keys";
import { authFail, authOk, type AuthResult } from "./result";

export interface BotKeyAuth {
  ownerId: string;
  botId: string;
  apiKeyId: string;
}

/**
 * Resolve a `bp_live_*` plaintext key to its bot. Returns a tagged result
 * so the caller can log the precise `auth_failure_reason` while still
 * returning a byte-identical 401 body across all branches.
 *
 * Failure reasons:
 *   - `wrong_credential_type` — non-`bp_live_` prefix (caller probably sent a PAT)
 *   - `unknown_key`           — hash not in the database
 *   - `revoked_key`           — key was revoked
 *   - `revoked_bot`           — bot itself is revoked (key is dead by extension)
 *
 * Fire-and-forget: stamps `lastUsedAt = now()` on a successful resolve so
 * the UI/listing surfaces "is this key dormant?". Errors on the stamp are
 * swallowed — auth has already succeeded and the freshness signal is
 * advisory.
 */
export async function botKeyAuth(
  plaintext: string,
  pepper: string,
): Promise<AuthResult<BotKeyAuth>> {
  if (!plaintext.startsWith("bp_live_")) return authFail("wrong_credential_type");
  const hash = hashKey(plaintext, pepper);
  const row = await prisma.botApiKey.findUnique({
    where: { keyHash: hash },
    select: {
      id: true,
      revokedAt: true,
      bot: { select: { id: true, ownerId: true, status: true } },
    },
  });
  if (!row) return authFail("unknown_key");
  if (row.revokedAt) return authFail("revoked_key");
  if (row.bot.status !== "ACTIVE") return authFail("revoked_bot");
  // Fire-and-forget: don't block the auth path on the stamp.
  void prisma.botApiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return authOk({
    ownerId: row.bot.ownerId,
    botId: row.bot.id,
    apiKeyId: row.id,
  });
}

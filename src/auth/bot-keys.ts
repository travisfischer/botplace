// Bot-key auth resolver. Mirrors the PAT resolver but routes a `bp_live_*`
// plaintext to a Bot (and its current owner + the specific api key id used,
// for audit). Used by the pixel-write API.

import { prisma } from "@/lib/prisma";
import { hashKey } from "./api-keys";

export interface BotKeyAuth {
  ownerId: string;
  botId: string;
  apiKeyId: string;
}

/**
 * Resolve a `bp_live_*` plaintext key to its bot. Returns null on:
 *   - non-bot-key prefix (refuses to validate PATs as bot keys),
 *   - unknown key hash,
 *   - revoked api key,
 *   - bot itself revoked.
 *
 * Caller maps null → 401 (byte-identical body across all branches per the
 * M1 NFR; the structured log differentiates via `auth_failure_reason`).
 *
 * Fire-and-forget: stamps `lastUsedAt = now()` on a successful resolve so
 * the UI/listing surfaces "is this key dormant?". Errors on the stamp are
 * swallowed — auth has already succeeded and the freshness signal is
 * advisory.
 */
export async function botKeyAuth(
  plaintext: string,
  pepper: string,
): Promise<BotKeyAuth | null> {
  if (!plaintext.startsWith("bp_live_")) return null;
  const hash = hashKey(plaintext, pepper);
  const row = await prisma.botApiKey.findUnique({
    where: { keyHash: hash },
    select: {
      id: true,
      revokedAt: true,
      bot: { select: { id: true, ownerId: true, status: true } },
    },
  });
  if (!row || row.revokedAt) return null;
  if (row.bot.status !== "ACTIVE") return null;
  // Fire-and-forget: don't block the auth path on the stamp.
  void prisma.botApiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return {
    ownerId: row.bot.ownerId,
    botId: row.bot.id,
    apiKeyId: row.id,
  };
}

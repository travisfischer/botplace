// @mention parsing + resolution for message-board content.
//
// Resolves `@<handle>` substrings in body text at write-time. Stores
// the resolved bot ids in `mentioned_bot_ids` on the Post/Reply row.
// Bot handles are persistent (no rename in M3), so this id-based
// metadata stays correct forever.
//
// Resolution policy:
//   - Regex matches the bot-handle format from src/bots/handle-format.ts.
//   - A leading non-alphanumeric boundary (or start-of-string) keeps
//     `email@domain.com` from matching as a mention.
//   - Deduped before DB lookup.
//   - Only ACTIVE bots resolve; REVOKED bots don't (their handle
//     might be reused in the future and we don't want to mis-attribute).
//     Today handles aren't renamed/reused, but the active-only filter
//     is the safe default.
//   - Unresolved mentions stay as literal text in body. No error.

import { prisma } from "@/lib/prisma";

// Mirrors the bot-handle regex from src/bots/handle-format.ts but
// scoped to the body-text scan. The leading group consumes the
// non-handle character (start-of-input or a non-alphanumeric) so
// `(?:^|[^a-z0-9])@conway` doesn't false-match in `email@conway.com`.
// `m` flag isn't needed — we're not anchored to lines.
const MENTION_REGEX = /(?:^|[^a-z0-9])@([a-z][a-z0-9-]{2,31})/g;

/**
 * Extract handles from body text. Pure function — no DB calls.
 * Deduped, lowercase, in order of first appearance.
 */
export function extractMentionedHandles(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of body.matchAll(MENTION_REGEX)) {
    const handle = match[1];
    if (!seen.has(handle)) {
      seen.add(handle);
      out.push(handle);
    }
  }
  return out;
}

/**
 * Resolve `@<handle>` mentions in body text to bot ids. Looks up each
 * handle in `bots`, filters to ACTIVE, returns the resolved ids in
 * the same order as first appearance in the body.
 */
export async function resolveMentionedBotIds(body: string): Promise<string[]> {
  const handles = extractMentionedHandles(body);
  if (handles.length === 0) return [];
  const bots = await prisma.bot.findMany({
    where: {
      handle: { in: handles },
      status: "ACTIVE",
    },
    select: { id: true, handle: true },
  });
  // Reorder to match the in-body appearance order.
  const byHandle = new Map(bots.map((b) => [b.handle, b.id]));
  return handles
    .map((h) => byHandle.get(h))
    .filter((id): id is string => id !== undefined);
}

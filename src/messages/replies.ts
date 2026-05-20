// Reply creation + read helpers. Same shape as src/messages/posts.ts
// but for the threaded-reply layer (Reply has no title/description/
// labels — just a body). One level of nesting only.

import { prisma } from "@/lib/prisma";

// Subset of the Bot row joined onto reply reads. Inlined rather than
// importing the full Prisma model to keep this module independent
// from generated types.
interface JoinedBot {
  id: string;
  handle: string;
  displayName: string;
}

export interface ReplyAuthorJson {
  id: string;
  handle: string;
  display_name: string;
}

export interface ReplyJson {
  id: string;
  post_id: string;
  sector_id: string;
  author: ReplyAuthorJson;
  body: string;
  mentioned_bot_ids: string[];
  created_at: string;
}

interface ReplyRowWithBot {
  id: bigint;
  postId: bigint;
  sectorId: string;
  body: string;
  mentionedBotIds: string[];
  createdAt: Date;
  bot: JoinedBot;
}

export function toReplyJson(row: ReplyRowWithBot): ReplyJson {
  return {
    id: row.id.toString(),
    post_id: row.postId.toString(),
    sector_id: row.sectorId,
    author: {
      id: row.bot.id,
      handle: row.bot.handle,
      display_name: row.bot.displayName,
    },
    body: row.body,
    mentioned_bot_ids: row.mentionedBotIds,
    created_at: row.createdAt.toISOString(),
  };
}

// ----------------------------------------------------------------------
// createReply
// ----------------------------------------------------------------------

export interface CreateReplyInput {
  postId: bigint;
  sectorId: string;
  botId: string;
  apiKeyId: string;
  body: string;
  mentionedBotIds: string[];
}

export type CreateReplyResult =
  | { ok: true; reply: ReplyJson }
  | { ok: false; kind: "post_not_found" };

/**
 * Insert a Reply row. Verifies the parent Post exists + is not
 * soft-deleted in the same database call by querying Post first.
 * A small TOCTOU window exists between the Post check and the Reply
 * insert; worst case is a reply attached to a just-deleted post,
 * which admin can also soft-delete. See R5 in the requirement.
 */
export async function createReply(
  input: CreateReplyInput,
): Promise<CreateReplyResult> {
  // Verify the parent post is non-deleted before inserting. We also
  // pull its sector_id from the same query — even though the caller
  // already passed `sectorId`, we use the post's authoritative sector
  // to avoid a mismatched-sector race where the bot was authenticated
  // for sector A but the post lives in sector B (impossible with one
  // sector today, but the schema supports many).
  const post = await prisma.post.findFirst({
    where: { id: input.postId, deletedAt: null },
    select: { id: true, sectorId: true },
  });
  if (!post) return { ok: false, kind: "post_not_found" };

  const row = await prisma.reply.create({
    data: {
      postId: input.postId,
      sectorId: post.sectorId,
      botId: input.botId,
      apiKeyId: input.apiKeyId,
      body: input.body,
      mentionedBotIds: input.mentionedBotIds,
    },
    include: {
      bot: { select: { id: true, handle: true, displayName: true } },
    },
  });
  return { ok: true, reply: toReplyJson(row) };
}

// ----------------------------------------------------------------------
// listRepliesForPost — thread order (oldest first)
// ----------------------------------------------------------------------

export async function listRepliesForPost(
  postId: bigint,
): Promise<ReplyJson[]> {
  const rows = await prisma.reply.findMany({
    where: { postId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      bot: { select: { id: true, handle: true, displayName: true } },
    },
  });
  return rows.map(toReplyJson);
}

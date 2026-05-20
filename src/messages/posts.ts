// Post creation + read helpers. Single source of truth for the
// message-board's parent-post data layer; consumed by:
//   - POST /api/v1/sectors/[id]/posts (write handler)
//   - GET  /api/v1/public/sectors/[id]/posts (list endpoint)
//   - GET  /api/v1/public/sectors/[id]/posts/[postId] (detail endpoint)
//   - /sectors/[id]/messages page (server component reads)
//
// Soft-delete handling: every public read filters `deletedAt IS NULL`.
// Admin endpoints bypass the filter to operate on already-deleted rows.

import { prisma } from "@/lib/prisma";

import { listRepliesForPost, type ReplyJson } from "./replies";

// Subset of the Bot row joined onto post reads. Inlined rather than
// importing the full Prisma model to keep this module independent
// from generated types.
interface JoinedBot {
  id: string;
  handle: string;
  displayName: string;
}

// ----------------------------------------------------------------------
// JSON-shape types — what we emit to API consumers + the page UI.
// ----------------------------------------------------------------------

export interface PostAuthorJson {
  /** Bot CUID. Stable join key. */
  id: string;
  /** Bot handle. Public canonical identifier. */
  handle: string;
  /** Bot display name. Freely editable per-bot label. */
  display_name: string;
}

export interface PostJson {
  /** BigInt post id as string (BigInt doesn't survive JSON). */
  id: string;
  sector_id: string;
  author: PostAuthorJson;
  title: string;
  description: string | null;
  body: string;
  labels: string[];
  mentioned_bot_ids: string[];
  created_at: string;
}

export interface PostListItemJson extends PostJson {
  /** Number of non-deleted replies on the post. */
  reply_count: number;
  /** Most recent activity timestamp. Equal to the latest non-deleted
   *  reply's createdAt, or the post's own createdAt if no replies. */
  last_activity_at: string;
}

export interface PostDetailJson extends PostJson {
  replies: ReplyJson[];
}

// ----------------------------------------------------------------------
// Shape helpers
// ----------------------------------------------------------------------

interface PostRowWithBot {
  id: bigint;
  sectorId: string;
  title: string;
  description: string | null;
  body: string;
  labels: string[];
  mentionedBotIds: string[];
  createdAt: Date;
  bot: JoinedBot;
}

export function toPostJson(row: PostRowWithBot): PostJson {
  return {
    id: row.id.toString(),
    sector_id: row.sectorId,
    author: {
      id: row.bot.id,
      handle: row.bot.handle,
      display_name: row.bot.displayName,
    },
    title: row.title,
    description: row.description,
    body: row.body,
    labels: row.labels,
    mentioned_bot_ids: row.mentionedBotIds,
    created_at: row.createdAt.toISOString(),
  };
}

// ----------------------------------------------------------------------
// createPost
// ----------------------------------------------------------------------

export interface CreatePostInput {
  sectorId: string;
  botId: string;
  apiKeyId: string;
  title: string;
  description: string | null;
  body: string;
  labels: string[];
  mentionedBotIds: string[];
}

/**
 * Insert a Post row + return it with the author Bot joined.
 * Caller has already validated content + resolved mentions.
 */
export async function createPost(input: CreatePostInput): Promise<PostJson> {
  const row = await prisma.post.create({
    data: {
      sectorId: input.sectorId,
      botId: input.botId,
      apiKeyId: input.apiKeyId,
      title: input.title,
      description: input.description,
      body: input.body,
      labels: input.labels,
      mentionedBotIds: input.mentionedBotIds,
    },
    include: {
      bot: { select: { id: true, handle: true, displayName: true } },
    },
  });
  return toPostJson(row);
}

// ----------------------------------------------------------------------
// loadPostById — single detail, with replies
// ----------------------------------------------------------------------

export type LoadPostByIdResult =
  | { ok: true; post: PostDetailJson }
  | { ok: false; kind: "not_found" };

/**
 * Load a single post by id, with all non-deleted replies in thread
 * order (oldest first). Soft-deleted posts return `not_found`.
 */
export async function loadPostById(
  postId: bigint,
): Promise<LoadPostByIdResult> {
  const row = await prisma.post.findFirst({
    where: { id: postId, deletedAt: null },
    include: {
      bot: { select: { id: true, handle: true, displayName: true } },
    },
  });
  if (!row) return { ok: false, kind: "not_found" };
  const replies = await listRepliesForPost(postId);
  return {
    ok: true,
    post: { ...toPostJson(row), replies },
  };
}

// ----------------------------------------------------------------------
// listPostsForSector — paginated parent posts
// ----------------------------------------------------------------------

export type PostSort = "recent_post" | "recent_activity";

export interface ListPostsInput {
  sectorId: string;
  sort: PostSort;
  /** ISO datetime cursor: return posts strictly older than this. */
  before?: Date;
  /** Max results, capped at 50. */
  limit: number;
}

export interface ListPostsResult {
  posts: PostListItemJson[];
  /** Set when more results are available past the returned page. */
  next_before?: string;
}

// Raw row shape from the `recent_post` query (Prisma findMany + joined bot + reply aggregations).
interface PostListRowRaw {
  id: bigint;
  sector_id: string;
  title: string;
  description: string | null;
  body: string;
  labels: string[];
  mentioned_bot_ids: string[];
  created_at: Date;
  bot_id: string;
  bot_handle: string;
  bot_display_name: string;
  reply_count: bigint;
  last_activity_at: Date;
}

function rowToListItem(row: PostListRowRaw): PostListItemJson {
  return {
    id: row.id.toString(),
    sector_id: row.sector_id,
    author: {
      id: row.bot_id,
      handle: row.bot_handle,
      display_name: row.bot_display_name,
    },
    title: row.title,
    description: row.description,
    body: row.body,
    labels: row.labels,
    mentioned_bot_ids: row.mentioned_bot_ids,
    created_at: row.created_at.toISOString(),
    reply_count: Number(row.reply_count),
    last_activity_at: row.last_activity_at.toISOString(),
  };
}

export async function listPostsForSector(
  input: ListPostsInput,
): Promise<ListPostsResult> {
  // Both sort modes use the same projection. The difference is the
  // ORDER BY column. For `recent_post`, that's `p.created_at`; for
  // `recent_activity`, that's `GREATEST(p.created_at, MAX(r.created_at))`.
  //
  // The aggregation `COUNT(r.id) FILTER (WHERE r.deleted_at IS NULL)`
  // and `MAX(r.created_at) FILTER (...)` are correlated to the post
  // via the LEFT JOIN — at sector-1's launch volume (single digits of
  // posts) this is fine; at scale, denormalize a `last_activity_at`
  // column onto Post and update it from a reply-create transaction.
  //
  // Cursor pagination: `WHERE last_activity_at < before` for the
  // recent_activity sort, `WHERE created_at < before` for recent_post.
  // We fetch limit+1 rows so we can determine whether more exist;
  // truncate to `limit` and pop the last id as the next cursor.
  const limit = Math.min(Math.max(input.limit, 1), 50);
  const sectorId = input.sectorId;
  const beforeDate = input.before;
  const isActivitySort = input.sort === "recent_activity";

  // Raw SQL for the aggregation + cursor — Prisma's groupBy doesn't
  // express FILTER + GREATEST cleanly enough to be worth it here.
  const rows = await prisma.$queryRaw<PostListRowRaw[]>`
    WITH activity AS (
      SELECT
        p.id,
        p.sector_id,
        p.title,
        p.description,
        p.body,
        p.labels,
        p.mentioned_bot_ids,
        p.created_at,
        b.id           AS bot_id,
        b.handle       AS bot_handle,
        b.display_name AS bot_display_name,
        COUNT(r.id) FILTER (WHERE r.deleted_at IS NULL) AS reply_count,
        COALESCE(MAX(r.created_at) FILTER (WHERE r.deleted_at IS NULL), p.created_at)
                                                          AS last_activity_at
      FROM posts p
      JOIN bots b   ON b.id = p.bot_id
      LEFT JOIN replies r ON r.post_id = p.id
      WHERE p.sector_id = ${sectorId}
        AND p.deleted_at IS NULL
      GROUP BY p.id, b.id
    )
    SELECT *
    FROM activity
    WHERE
      CASE
        WHEN ${isActivitySort}::boolean THEN
          ${beforeDate ?? null}::timestamp IS NULL
            OR last_activity_at < ${beforeDate ?? null}::timestamp
        ELSE
          ${beforeDate ?? null}::timestamp IS NULL
            OR created_at < ${beforeDate ?? null}::timestamp
      END
    ORDER BY
      CASE WHEN ${isActivitySort}::boolean THEN last_activity_at END DESC NULLS LAST,
      CASE WHEN NOT ${isActivitySort}::boolean THEN created_at END DESC NULLS LAST
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const items = trimmed.map(rowToListItem);
  // Cursor is the LAST returned item's activity / creation timestamp,
  // depending on sort mode.
  const lastItem = items[items.length - 1];
  const nextBefore =
    hasMore && lastItem
      ? isActivitySort
        ? lastItem.last_activity_at
        : lastItem.created_at
      : undefined;

  return { posts: items, next_before: nextBefore };
}

// Sector message firehose — paginated stream of every post + reply
// in the sector, intermingled, ordered by created_at desc. Each entry
// carries a `kind` discriminator so consumers can tell which surface
// produced it.
//
// Implementation: a UNION ALL over (posts × bots) and (replies × bots)
// projected to a uniform row shape. The (sector_id, created_at) index
// on each table makes the per-table scan + sort cheap; the union
// merges them with an outer ORDER BY created_at DESC + LIMIT.

import { prisma } from "@/lib/prisma";

export interface FirehoseAuthorJson {
  id: string;
  handle: string;
  display_name: string;
}

export type FirehoseEntry =
  | {
      kind: "post";
      id: string;
      sector_id: string;
      author: FirehoseAuthorJson;
      title: string;
      description: string | null;
      body: string;
      labels: string[];
      mentioned_bot_ids: string[];
      created_at: string;
    }
  | {
      kind: "reply";
      id: string;
      post_id: string;
      sector_id: string;
      author: FirehoseAuthorJson;
      body: string;
      mentioned_bot_ids: string[];
      created_at: string;
    };

export interface ListFirehoseInput {
  sectorId: string;
  /** ISO datetime cursor: return entries strictly older than this. */
  before?: Date;
  /** Max results across both posts + replies. Capped at 50. */
  limit: number;
}

export interface ListFirehoseResult {
  entries: FirehoseEntry[];
  next_before?: string;
}

interface FirehoseRow {
  kind: "post" | "reply";
  id: bigint;
  post_id: bigint | null;
  sector_id: string;
  bot_id: string;
  bot_handle: string;
  bot_display_name: string;
  title: string | null;
  description: string | null;
  body: string;
  labels: string[] | null;
  mentioned_bot_ids: string[];
  created_at: Date;
}

export async function listSectorMessageFirehose(
  input: ListFirehoseInput,
): Promise<ListFirehoseResult> {
  const limit = Math.min(Math.max(input.limit, 1), 50);
  const sectorId = input.sectorId;
  const before = input.before ?? null;

  // UNION ALL the two tables into a uniform projection. Filter
  // soft-deleted rows out at the per-table level (cheaper than
  // filtering after the union). The outer ORDER BY + LIMIT lets
  // Postgres merge-sort the two pre-sorted streams.
  const rows = await prisma.$queryRaw<FirehoseRow[]>`
    (
      SELECT
        'post'::text   AS kind,
        p.id           AS id,
        NULL::bigint   AS post_id,
        p.sector_id    AS sector_id,
        b.id           AS bot_id,
        b.handle       AS bot_handle,
        b.display_name AS bot_display_name,
        p.title        AS title,
        p.description  AS description,
        p.body         AS body,
        p.labels       AS labels,
        p.mentioned_bot_ids AS mentioned_bot_ids,
        p.created_at   AS created_at
      FROM posts p
      JOIN bots b ON b.id = p.bot_id
      WHERE p.sector_id = ${sectorId}
        AND p.deleted_at IS NULL
        AND (${before}::timestamp IS NULL OR p.created_at < ${before}::timestamp)
      ORDER BY p.created_at DESC
      LIMIT ${limit + 1}
    )
    UNION ALL
    (
      SELECT
        'reply'::text  AS kind,
        r.id           AS id,
        r.post_id      AS post_id,
        r.sector_id    AS sector_id,
        b.id           AS bot_id,
        b.handle       AS bot_handle,
        b.display_name AS bot_display_name,
        NULL::text     AS title,
        NULL::text     AS description,
        r.body         AS body,
        NULL::text[]   AS labels,
        r.mentioned_bot_ids AS mentioned_bot_ids,
        r.created_at   AS created_at
      FROM replies r
      JOIN bots b ON b.id = r.bot_id
      WHERE r.sector_id = ${sectorId}
        AND r.deleted_at IS NULL
        AND (${before}::timestamp IS NULL OR r.created_at < ${before}::timestamp)
      ORDER BY r.created_at DESC
      LIMIT ${limit + 1}
    )
    ORDER BY created_at DESC
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const entries = trimmed.map(toFirehoseEntry);
  const lastEntry = entries[entries.length - 1];
  const nextBefore =
    hasMore && lastEntry ? lastEntry.created_at : undefined;

  return { entries, next_before: nextBefore };
}

function toFirehoseEntry(row: FirehoseRow): FirehoseEntry {
  const author = {
    id: row.bot_id,
    handle: row.bot_handle,
    display_name: row.bot_display_name,
  };
  if (row.kind === "post") {
    return {
      kind: "post",
      id: row.id.toString(),
      sector_id: row.sector_id,
      author,
      title: row.title ?? "",
      description: row.description,
      body: row.body,
      labels: row.labels ?? [],
      mentioned_bot_ids: row.mentioned_bot_ids,
      created_at: row.created_at.toISOString(),
    };
  }
  return {
    kind: "reply",
    id: row.id.toString(),
    post_id: row.post_id?.toString() ?? "",
    sector_id: row.sector_id,
    author,
    body: row.body,
    mentioned_bot_ids: row.mentioned_bot_ids,
    created_at: row.created_at.toISOString(),
  };
}

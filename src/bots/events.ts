// Shared domain logic for "load a bot's recent pixel events." The
// public events API route at `app/api/v1/public/bots/[handle]/events`
// and the SSR profile page at `app/bots/[handle]/page.tsx` both need
// the same query shape (handle → bot.id → `pixelEvent.findMany`
// ordered desc by `createdAt`, with optional `since`/`before`
// cursor). Living here keeps the two call sites from drifting apart
// when the query evolves.

import { prisma } from "@/lib/prisma";

/**
 * Internal event row shape. The wire shape is a thin transform of
 * this — callers serialize before returning to clients. `chunkVersionAfter`
 * is included because the public events API exposes it; SSR-only
 * consumers (the profile page) ignore the field.
 */
export interface BotEventRow {
  x: number;
  y: number;
  color: number;
  paletteVersion: number;
  createdAt: Date;
  chunkVersionAfter: bigint;
  sectorId: string;
  comment: string | null;
}

/**
 * Cursor for backward / forward pagination. Both directions are
 * mutually exclusive at the API boundary; callers should reject
 * "both specified" before calling this function. If neither is set,
 * the query returns the most recent `limit` rows.
 */
export interface EventCursor {
  since?: Date;
  before?: Date;
}

export interface LoadBotEventsResult {
  /** Bot lookup result. `null` when the handle doesn't resolve. */
  botId: string | null;
  /** Events for the bot. Empty when `botId` is null OR the bot has no matching rows. */
  events: BotEventRow[];
}

/**
 * Look up a bot by handle, then load its recent events with optional
 * cursor. Returns `{ botId: null, events: [] }` for unknown handles so
 * callers can disambiguate "no such bot" from "bot exists but has no
 * events" — the public events API uses this to return 200 [] (stale-
 * handle behavior) and the profile page uses it to know the bot is
 * present after `getBotPublicDetail` already resolved.
 *
 * `suppressComment` is the caller's responsibility — pass
 * `commentsDisabled()` from `@/src/pixels` if the result is going to a
 * public read surface. Skip it when the result feeds owner-side tooling
 * that needs the raw stored comment.
 */
export async function loadBotEventsByHandle(input: {
  handle: string;
  limit: number;
  cursor?: EventCursor;
  suppressComment: boolean;
}): Promise<LoadBotEventsResult> {
  const bot = await prisma.bot.findUnique({
    where: { handle: input.handle },
    select: { id: true },
  });
  if (!bot) return { botId: null, events: [] };

  const where: Record<string, unknown> = { botId: bot.id };
  if (input.cursor?.since !== undefined) {
    where.createdAt = { gt: input.cursor.since };
  } else if (input.cursor?.before !== undefined) {
    where.createdAt = { lt: input.cursor.before };
  }

  const rows = await prisma.pixelEvent.findMany({
    where: where as never,
    orderBy: { createdAt: "desc" },
    take: input.limit,
    select: {
      x: true,
      y: true,
      color: true,
      paletteVersion: true,
      createdAt: true,
      chunkVersionAfter: true,
      sectorId: true,
      comment: true,
    },
  });

  const events: BotEventRow[] = input.suppressComment
    ? rows.map((r) => ({ ...r, comment: null }))
    : rows;

  return { botId: bot.id, events };
}

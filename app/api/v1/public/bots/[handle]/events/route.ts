// GET /api/v1/public/bots/:handle/events — recent events for one bot.
// Public, no auth. Hot path for the viewer's "see this bot's recent
// activity" affordance backing click-to-inspect.
//
// Privacy: returns x, y, color, palette_version, accepted_at,
// chunk_version_after, sector_id, comment. No bot_id (`handle` is
// canonical), no owner_id, no api_key_id, no request_id.
//
// Stale-handle behavior: returns `[]` (200) for an unknown handle —
// does NOT 404. The click-to-inspect UX shouldn't break if a bot's
// handle is read from a cached response and queried after the bot
// was deleted by an operator.
//
// Query parameters:
//   ?limit=N      Number of events (default 20, max 100).
//   ?since=ISO    Only events with accepted_at > since (forward catch-up).
//   ?before=ISO   Only events with accepted_at < before (backward
//                 paginate). Mutually exclusive with `?since` —
//                 specifying both returns 400. Used by the bot
//                 profile page's "Load more" button.
//
// Optimized for the click-to-inspect read pattern: a small number of
// recent events for a single handle. Uses (botId, createdAt) index.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";
import { loadBotEventsByHandle, type BotEventRow } from "@/src/bots/events";
import { isValidHandle, validateHandle } from "@/src/bots/handle";
import { commentsDisabled } from "@/src/pixels";

const CACHE_CONTROL = "public, s-maxage=2, stale-while-revalidate=10";
const CDN_CACHE_CONTROL = "public, s-maxage=2, stale-while-revalidate=10";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseSince(raw: string | null): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return new Date(t);
}

/**
 * `?before=<iso>` is the backward-pagination cursor — used by the
 * bot profile page's "Load more" button to walk older history.
 *
 * Returns:
 *   - `null` when no `?before=` query param was supplied.
 *   - `"invalid"` when the param was supplied but did not parse as a
 *     date (caller should 400 with `reason: "before_invalid"`).
 *   - `Date` otherwise.
 *
 * The asymmetry vs. `parseSince` (which silently drops garbage) is
 * deliberate: `before` is a paginating cursor — a client constructing
 * "Load more" off a bad cursor must be told its loop is broken rather
 * than silently restarted from the head of history.
 */
function parseBefore(raw: string | null): Date | null | "invalid" {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return "invalid";
  return new Date(t);
}

function toWire(e: BotEventRow): Record<string, unknown> {
  return {
    x: e.x,
    y: e.y,
    color: e.color,
    palette_version: e.paletteVersion,
    accepted_at: e.createdAt.toISOString(),
    chunk_version_after: e.chunkVersionAfter.toString(),
    sector_id: e.sectorId,
    comment: e.comment,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { handle } = await params;
  const path = `/api/v1/public/bots/${handle}/events`;

  const rl = await checkPublicReadRateLimit(clientIpFrom(request));
  if (!rl.ok) {
    return publicReadRateLimitResponse(rl, {
      requestId,
      path,
      sectorId: "n/a",
      startedAt,
    });
  }
  const rlHeaders = publicReadRateLimitHeaders(rl.publicRead);

  // Syntactic handle check — short-circuits before hitting the DB
  // for obviously-malformed handles. Same regex/reserved module the
  // owner-create path uses; reserved-name handles are still queryable
  // (the M2.5 launch bots got there first under their conventional
  // names — the DB unique index is the source of truth for who owns
  // a handle, not this validator).
  const reservedButQueryable = (() => {
    const err = validateHandle(handle);
    return err?.slug === "handle_reserved";
  })();
  if (!isValidHandle(handle) && !reservedButQueryable) {
    log("warn", {
      request_id: requestId,
      path,
      status: 400,
      error_slug: "invalid_input",
      auth_type: "public",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      {
        error: "invalid_input",
        field: "handle",
        reason: "handle_invalid_characters",
        message:
          "`handle` must match /^[a-z][a-z0-9-]{2,31}$/ with no consecutive or boundary hyphens.",
        request_id: requestId,
      },
      {
        status: 400,
        headers: { "X-Request-Id": requestId, ...rlHeaders },
      },
    );
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const since = parseSince(url.searchParams.get("since"));
  const before = parseBefore(url.searchParams.get("before"));

  if (before === "invalid") {
    log("warn", {
      request_id: requestId,
      path,
      status: 400,
      error_slug: "invalid_input",
      auth_type: "public",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      {
        error: "invalid_input",
        field: "before",
        reason: "before_invalid",
        message: "`before` must be an ISO-8601 timestamp",
        request_id: requestId,
      },
      {
        status: 400,
        headers: { "X-Request-Id": requestId, ...rlHeaders },
      },
    );
  }

  // `since` (catch up forward) and `before` (paginate backward) are
  // mutually exclusive — the cursor is one direction at a time. If
  // both are present, refuse: a caller passing both has a bug in
  // their cursor logic and a silent precedence rule would mask it.
  if (since !== null && before !== null) {
    log("warn", {
      request_id: requestId,
      path,
      status: 400,
      error_slug: "invalid_input",
      auth_type: "public",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      {
        error: "invalid_input",
        field: "before",
        reason: "before_and_since_exclusive",
        message: "`before` and `since` cannot both be specified",
        request_id: requestId,
      },
      {
        status: 400,
        headers: { "X-Request-Id": requestId, ...rlHeaders },
      },
    );
  }

  try {
    const cursor =
      since !== null
        ? { since }
        : before !== null
          ? { before }
          : undefined;

    const { botId, events } = await loadBotEventsByHandle({
      handle,
      limit,
      cursor,
      suppressComment: commentsDisabled(),
    });

    if (botId === null) {
      // Stale-handle behavior — see doc comment above.
      log("info", {
        request_id: requestId,
        path,
        status: 200,
        auth_type: "public",
        bot_handle: handle,
        bot_known: false,
        event_count: 0,
        latency_ms: Date.now() - startedAt,
      });
      return Response.json([], {
        headers: {
          "Cache-Control": CACHE_CONTROL,
          "CDN-Cache-Control": CDN_CACHE_CONTROL,
          "X-Request-Id": requestId,
          ...rlHeaders,
        },
      });
    }

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      bot_handle: handle,
      bot_known: true,
      event_count: events.length,
      latency_ms: Date.now() - startedAt,
    });

    return Response.json(events.map(toWire), {
      headers: {
        "Cache-Control": CACHE_CONTROL,
        "CDN-Cache-Control": CDN_CACHE_CONTROL,
        "X-Request-Id": requestId,
        ...rlHeaders,
      },
    });
  } catch (err) {
    log("error", {
      request_id: requestId,
      path,
      status: 500,
      error_slug: "internal_error",
      auth_type: "public",
      bot_handle: handle,
      dependency: "neon",
      error_class: err instanceof Error ? err.constructor.name : "unknown",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "internal_error", request_id: requestId },
      {
        status: 500,
        headers: { "X-Request-Id": requestId, ...rlHeaders },
      },
    );
  }
}

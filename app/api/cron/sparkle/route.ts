// GET /api/cron/sparkle — M2.5 launch bot.
//
// Adds a glowing halo to the most recent non-self pixel write. Each tick:
//   1. Read recent events from /api/v1/public/sectors/sector-1/events
//      (filtering out sparkle's own writes by bot_name).
//   2. If a non-self event exists, paint 8 sparkle pixels at cardinal +
//      diagonal offsets from that anchor (skipping out-of-bounds).
//   3. Each sparkle pixel is palette index 7 (off-white #dcf5ff), spaced
//      ≥1.1s apart to honor the POWER tier rate limit.
//
// Visual: a soft halo follows whichever bot wrote most recently.
//
// If no non-self events in the last ~60s, sparkle sleeps this tick.

import { randomUUID } from "node:crypto";

import { log } from "@/lib/log";
import {
  fetchEvents,
  fetchSectorMeta,
  isAuthorizedCron,
  isLaunchBotsEnabled,
  sleep,
  writePixel,
} from "@/src/launch-bots/runner";
import {
  SPARKLE_COLOR,
  pickNonSelfAnchor,
  sparkleTargets,
} from "@/src/launch-bots/sparkle-logic";

const PATH = "/api/cron/sparkle";
const SECTOR_ID = "sector-1";
const SELF_BOT_NAME = "m25-sparkle";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  if (!isAuthorizedCron(request)) {
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 404,
      error_slug: "not_found",
    });
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // Soft-launch gate. See visitor-pulse for the rationale.
  if (!isLaunchBotsEnabled()) {
    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      bot_name: SELF_BOT_NAME,
      skipped: true,
      reason: "bots_disabled",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json({
      bot: SELF_BOT_NAME,
      skipped: true,
      reason: "bots_disabled",
    });
  }

  const apiKey = process.env.M25_SPARKLE_KEY;
  if (!apiKey) {
    // Byte-identical to the wrong-CRON_SECRET response — see
    // visitor-pulse for rationale.
    log("error", {
      request_id: requestId,
      path: PATH,
      status: 404,
      error_slug: "missing_bot_key",
    });
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const signal = request.signal;

  try {
    // Pull recent events + sector dimensions in parallel.
    const [events, meta] = await Promise.all([
      fetchEvents(SECTOR_ID, 20, signal),
      fetchSectorMeta(SECTOR_ID, signal),
    ]);

    // Most recent non-self event. /events returns descending by id, so
    // the first non-self entry is the freshest.
    const anchor = pickNonSelfAnchor(events, SELF_BOT_NAME);
    if (!anchor) {
      log("info", {
        request_id: requestId,
        path: PATH,
        status: 200,
        bot_name: SELF_BOT_NAME,
        sparkle_skipped: true,
        reason: "no_non_self_event",
        latency_ms: Date.now() - startedAt,
      });
      return Response.json({
        bot: SELF_BOT_NAME,
        skipped: true,
        reason: "no_non_self_event",
      });
    }

    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      bot_name: SELF_BOT_NAME,
      anchor: { x: anchor.x, y: anchor.y, author: anchor.bot_name },
    });

    // Paint up to 8 sparkle pixels around the anchor, clipped to the
    // canvas bounds.
    const targets = sparkleTargets(anchor.x, anchor.y, meta.width, meta.height);

    let written = 0;
    let firstError: string | undefined;
    let firstErrorServerRequestId: string | undefined;
    for (const [x, y] of targets) {
      const result = await writePixel(
        {
          apiKey,
          sectorId: SECTOR_ID,
          x,
          y,
          color: SPARKLE_COLOR,
          parentRequestId: requestId,
        },
        signal,
      );
      if (!result.ok) {
        firstError = firstError ?? result.error;
        firstErrorServerRequestId = firstErrorServerRequestId ?? result.serverRequestId;
        break;
      }
      written++;
      await sleep(1100, signal);
    }

    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      bot_name: SELF_BOT_NAME,
      pixels_written: written,
      latency_ms: Date.now() - startedAt,
      ...(firstError ? { error_slug: firstError } : {}),
      ...(firstErrorServerRequestId
        ? { downstream_request_id: firstErrorServerRequestId }
        : {}),
    });

    return Response.json({
      bot: SELF_BOT_NAME,
      anchor: { x: anchor.x, y: anchor.y },
      pixels_written: written,
      ...(firstError ? { first_error: firstError } : {}),
    });
  } catch (err) {
    log("error", {
      request_id: requestId,
      path: PATH,
      status: 500,
      error_slug: "internal_error",
      error_class: err instanceof Error ? err.constructor.name : "unknown",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

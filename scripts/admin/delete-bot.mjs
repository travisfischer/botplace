// scripts/admin/delete-bot.mjs
//
//   pnpm admin:delete-bot --bot <handle|id> --actor <email>
//
// Hard-deletes a bot and its api keys (irreversible). Refuses to run if
// the bot has ANY child rows in `pixel_events`, `posts`, or `replies` —
// those are Restrict-on-delete by schema design to keep canvas /
// discourse audit lineage intact; clear them first via the
// `admin:reset-sector-*` CLIs. Writes one ADMIN_ACCOUNT audit row.
// Exported function is tested in tests/admin/delete-bot.test.ts.

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  confirmRetype,
  dbTargetLabel,
  flagValue,
  makeClient,
  OwnerLookupError,
  requireAdminActor,
  writeAudit,
} from "./_common.mjs";

/**
 * Resolve a bot row by handle, then by id. Handles are globally unique
 * (DB constraint), ids are cuids — collisions between the two
 * namespaces are effectively impossible, but resolving by handle first
 * matches operator intent (the user-facing identifier wins).
 *
 * @param {import('pg').Client} client
 * @param {string} value
 * @returns {Promise<{ id: string, handle: string, ownerId: string, displayName: string, status: string, rateTier: string } | null>}
 */
async function resolveBot(client, value) {
  const byHandle = await client.query(
    `SELECT id, handle, owner_id, display_name, status::text, rate_tier::text
       FROM bots WHERE handle = $1`,
    [value],
  );
  if (byHandle.rows.length === 1) {
    return rowToBot(byHandle.rows[0]);
  }
  const byId = await client.query(
    `SELECT id, handle, owner_id, display_name, status::text, rate_tier::text
       FROM bots WHERE id = $1`,
    [value],
  );
  if (byId.rows.length === 1) {
    return rowToBot(byId.rows[0]);
  }
  return null;
}

function rowToBot(row) {
  return {
    id: row.id,
    handle: row.handle,
    ownerId: row.owner_id,
    displayName: row.display_name,
    status: row.status,
    rateTier: row.rate_tier,
  };
}

/**
 * @param {import('pg').Client} client
 * @param {string} botId
 * @returns {Promise<{ pixelEvents: number, posts: number, replies: number, keys: number, sectorsPainted: string[] }>}
 */
async function countChildren(client, botId) {
  const counts = await client.query(
    `SELECT
       (SELECT count(*)::int FROM pixel_events WHERE bot_id = $1) AS pixel_events,
       (SELECT count(*)::int FROM posts        WHERE bot_id = $1) AS posts,
       (SELECT count(*)::int FROM replies      WHERE bot_id = $1) AS replies,
       (SELECT count(*)::int FROM bot_api_keys WHERE bot_id = $1) AS keys`,
    [botId],
  );
  const sectors = await client.query(
    `SELECT DISTINCT sector_id FROM pixel_events WHERE bot_id = $1 ORDER BY sector_id`,
    [botId],
  );
  const row = counts.rows[0];
  return {
    pixelEvents: row.pixel_events,
    posts: row.posts,
    replies: row.replies,
    keys: row.keys,
    sectorsPainted: sectors.rows.map((r) => r.sector_id),
  };
}

class BotDeleteRefused extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BotDeleteRefused";
    this.code = code;
  }
}

/**
 * Delete a single bot (hard) + its api keys + write one audit row. All
 * three operations run in one transaction. Refuses if any
 * audit-relevant child row (pixel_events / posts / replies) still
 * exists for the bot — those FKs are Restrict by schema design.
 *
 * @param {import('pg').Client} client
 * @param {{ bot?: string, ownerId?: string, email?: string, requestId?: string, sourceIp?: string }} [opts]
 * @returns {Promise<{ bot: { id: string, handle: string }, keysDeleted: number }>}
 */
export async function deleteBot(
  client,
  { bot: botValue, ownerId, email, requestId = randomUUID(), sourceIp = "cli" } = {},
) {
  if (!botValue) throw new Error("bot required");

  // Verify the actor is an admin BEFORE any lookup or mutation.
  const actor = await requireAdminActor(client, { ownerId, email });

  const bot = await resolveBot(client, botValue);
  if (!bot) {
    const e = new BotDeleteRefused("bot_not_found", `No bot with handle or id "${botValue}"`);
    throw e;
  }

  const children = await countChildren(client, bot.id);

  if (children.pixelEvents > 0) {
    const sectors = children.sectorsPainted.join(", ");
    throw new BotDeleteRefused(
      "bot_has_pixel_events",
      `Bot ${bot.handle} (${bot.id}) has ${children.pixelEvents} pixel_events across sector(s) [${sectors}]. ` +
        `Clear them first with: pnpm admin:reset-sector-pixels --sector <id> --actor <email> (per sector).`,
    );
  }
  if (children.posts > 0) {
    throw new BotDeleteRefused(
      "bot_has_posts",
      `Bot ${bot.handle} (${bot.id}) authored ${children.posts} posts. ` +
        `Clear them first with: pnpm admin:reset-sector-messages --sector <id> --actor <email>.`,
    );
  }
  if (children.replies > 0) {
    throw new BotDeleteRefused(
      "bot_has_replies",
      `Bot ${bot.handle} (${bot.id}) authored ${children.replies} replies. ` +
        `Clear them first with: pnpm admin:reset-sector-messages --sector <id> --actor <email>.`,
    );
  }

  await client.query("BEGIN");
  try {
    // Audit BEFORE the bot row goes away. `target_id` is free-text (no
    // FK), so the audit row survives the bot delete.
    await writeAudit(client, {
      requestId,
      action: "delete_bot",
      actorKind: "ADMIN_ACCOUNT",
      targetId: bot.id,
      payload: {
        actor_owner_id: actor.id,
        actor_email: actor.email,
        handle: bot.handle,
        owner_id: bot.ownerId,
        display_name: bot.displayName,
        status: bot.status,
        rate_tier: bot.rateTier,
        keys_deleted: children.keys,
      },
      sourceIp,
    });

    const keysRes = await client.query("DELETE FROM bot_api_keys WHERE bot_id = $1", [bot.id]);
    const keysDeleted = keysRes.rowCount ?? 0;

    await client.query("DELETE FROM bots WHERE id = $1", [bot.id]);

    await client.query("COMMIT");
    return { bot: { id: bot.id, handle: bot.handle }, keysDeleted };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

const USAGE = `Usage:
  node scripts/admin/delete-bot.mjs --bot <handle|id> --actor <email> [--actor-id <id>] [--yes] [--dry-run]`;

async function main() {
  await import("dotenv/config");
  const args = process.argv.slice(2);
  const botValue = flagValue(args, "--bot");
  const email = flagValue(args, "--actor");
  const ownerId = flagValue(args, "--actor-id");
  const yes = args.includes("--yes");
  const dryRun = args.includes("--dry-run");

  if (!botValue || (!email && !ownerId)) {
    console.error(USAGE);
    process.exit(2);
  }

  const client = makeClient(process.env.DATABASE_URL);
  await client.connect();
  try {
    const target = dbTargetLabel(process.env.DATABASE_URL);

    // Verify the actor is an admin BEFORE printing any preview — even
    // in --dry-run mode. The preview reveals owner_id, display_name,
    // and counts; gating it behind the same actor check the real run
    // uses keeps dry-run from leaking that surface to a non-admin
    // (and keeps "dry-run worked but real run refused" from being a
    // confusing UX). `deleteBot` re-runs the check inside its own
    // critical section; the duplication is intentional.
    try {
      await requireAdminActor(client, { ownerId, email });
    } catch (err) {
      if (err instanceof OwnerLookupError) {
        console.error(`delete-bot failed: [${err.code}] ${err.message}`);
        process.exit(1);
      }
      throw err;
    }

    // Pre-flight preview: resolve the bot and count children for the
    // warning. The exported `deleteBot` re-checks both inside its own
    // critical section — this read is purely cosmetic.
    const bot = await resolveBot(client, botValue);
    if (!bot) {
      console.error(`bot not found: "${botValue}" (no matching handle or id)`);
      process.exit(1);
    }
    const children = await countChildren(client, bot.id);

    const preview = {
      bot: {
        id: bot.id,
        handle: bot.handle,
        owner_id: bot.ownerId,
        display_name: bot.displayName,
        status: bot.status,
        rate_tier: bot.rateTier,
      },
      counts: {
        bot_api_keys: children.keys,
        pixel_events: children.pixelEvents,
        posts: children.posts,
        replies: children.replies,
        sectors_painted: children.sectorsPainted,
      },
      target,
    };

    if (dryRun) {
      console.log(JSON.stringify({ dryRun: true, ...preview }, null, 2));
      return;
    }

    console.error(
      `\n⚠️  PERMANENTLY deleting bot "${bot.handle}" (${bot.id}) on ${target}:\n` +
        `    owner=${bot.ownerId} display_name=${JSON.stringify(bot.displayName)} ` +
        `status=${bot.status} tier=${bot.rateTier}\n` +
        `    keys to delete: ${children.keys}  (pixel_events=${children.pixelEvents}, ` +
        `posts=${children.posts}, replies=${children.replies}). This is IRREVERSIBLE.\n`,
    );
    if (!yes && !(await confirmRetype(bot.handle))) {
      console.error("confirmation mismatch — aborting.");
      process.exit(3);
    }

    const res = await deleteBot(client, { bot: botValue, email, ownerId });
    console.log(JSON.stringify({ deleted: "bot", ...res }, null, 2));
  } catch (err) {
    const code = err?.code ? `[${err.code}] ` : "";
    console.error(`delete-bot failed: ${code}${err?.message ?? err}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

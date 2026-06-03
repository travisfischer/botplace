// scripts/admin/reset-sector-messages.mjs
//
//   pnpm admin:reset-sector-messages --sector <id> --actor <email>
//
// Hard-deletes every post + reply for one sector (irreversible). Both
// deletes run in a single transaction (FK order: replies before posts,
// since Reply.post_id is Restrict-on-delete). Writes one ADMIN_ACCOUNT
// audit row with the counts. The `--actor` must resolve to an admin
// owner. Exported function is tested in
// tests/admin/reset-sector-messages.test.ts.

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { confirmRetype, dbTargetLabel, flagValue, makeClient, requireAdminActor, writeAudit } from "./_common.mjs";

/**
 * @param {import('pg').Client} client
 * @param {{ sectorId?: string, ownerId?: string, email?: string, requestId?: string, sourceIp?: string }} [opts]
 * @returns {Promise<{ postsDeleted: number, repliesDeleted: number }>}
 */
export async function resetSectorMessages(
  client,
  { sectorId, ownerId, email, requestId = randomUUID(), sourceIp = "cli" } = {},
) {
  if (!sectorId) throw new Error("sectorId required");

  // Verify the actor is an admin BEFORE mutating anything.
  const actor = await requireAdminActor(client, { ownerId, email });

  const sector = await client.query("SELECT id FROM sectors WHERE id = $1", [sectorId]);
  if (sector.rows.length === 0) {
    const e = new Error(`No sector with id ${sectorId}`);
    e.code = "sector_not_found";
    throw e;
  }

  await client.query("BEGIN");
  try {
    const replies = await client.query("DELETE FROM replies WHERE sector_id = $1", [sectorId]);
    const posts = await client.query("DELETE FROM posts WHERE sector_id = $1", [sectorId]);
    const repliesDeleted = replies.rowCount ?? 0;
    const postsDeleted = posts.rowCount ?? 0;

    await writeAudit(client, {
      requestId,
      action: "reset_sector_messages",
      actorKind: "ADMIN_ACCOUNT",
      targetId: sectorId,
      payload: {
        actor_owner_id: actor.id,
        actor_email: actor.email,
        posts_deleted: postsDeleted,
        replies_deleted: repliesDeleted,
      },
      sourceIp,
    });

    await client.query("COMMIT");
    return { postsDeleted, repliesDeleted };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

const USAGE = `Usage:
  node scripts/admin/reset-sector-messages.mjs --sector <id> --actor <email> [--actor-id <id>] [--yes]`;

async function main() {
  await import("dotenv/config");
  const args = process.argv.slice(2);
  const sectorId = flagValue(args, "--sector");
  const email = flagValue(args, "--actor");
  const ownerId = flagValue(args, "--actor-id");
  const yes = args.includes("--yes");

  if (!sectorId || (!email && !ownerId)) {
    console.error(USAGE);
    process.exit(2);
  }

  const client = makeClient(process.env.DATABASE_URL);
  await client.connect();
  try {
    const target = dbTargetLabel(process.env.DATABASE_URL);
    const counts = await client.query(
      `SELECT (SELECT count(*)::int FROM posts WHERE sector_id = $1) AS posts,
              (SELECT count(*)::int FROM replies WHERE sector_id = $1) AS replies`,
      [sectorId],
    );
    const { posts, replies } = counts.rows[0];
    console.error(
      `\n⚠️  PERMANENTLY deleting ALL messages for sector "${sectorId}" on ${target}:\n` +
        `    ${posts} posts + ${replies} replies. This is IRREVERSIBLE.\n`,
    );
    if (!yes && !(await confirmRetype(sectorId))) {
      console.error("confirmation mismatch — aborting.");
      process.exit(3);
    }
    const res = await resetSectorMessages(client, { sectorId, email, ownerId });
    console.log(JSON.stringify({ reset: "messages", sector: sectorId, ...res }, null, 2));
  } catch (err) {
    const code = err?.code ? `[${err.code}] ` : "";
    console.error(`reset-sector-messages failed: ${code}${err?.message ?? err}`);
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

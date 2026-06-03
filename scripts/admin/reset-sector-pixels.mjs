// scripts/admin/reset-sector-pixels.mjs
//
//   pnpm admin:reset-sector-pixels --sector <id> --actor <email>
//
// Resets a sector's canvas to the unwritten state (irreversible):
//   1. Blank every chunk: zero its `data` (preserving byte length) and
//      bump `version` FORWARD — never reset to 0, since the viewer's
//      incremental diffing + CDN/ETag caching rely on monotonic version.
//   2. Hard-delete the sector's `pixel_events` in autocommit batches —
//      bounded locks/WAL and resumable (a timeout just means "run again").
//   3. Write one ADMIN_ACCOUNT audit row with the counts.
//
// The caller (main / probe) should run `VACUUM (ANALYZE) pixel_events`
// afterwards to reclaim space; that's a maintenance step, not part of
// the logical reset. Exported function is tested in
// tests/admin/reset-sector-pixels.test.ts.

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { confirmRetype, flagValue, makeClient, requireAdminActor, writeAudit } from "./_common.mjs";

// Default delete batch size. At ~1.67M prod rows this keeps each
// statement bounded; override via --batch-size for tuning.
const DEFAULT_BATCH_SIZE = 10000;

/**
 * @param {import('pg').Client} client
 * @param {{ sectorId?: string, ownerId?: string, email?: string, batchSize?: number, requestId?: string, sourceIp?: string }} [opts]
 * @returns {Promise<{ chunksBlanked: number, eventsDeleted: number }>}
 */
export async function resetSectorPixels(
  client,
  {
    sectorId,
    ownerId,
    email,
    batchSize = DEFAULT_BATCH_SIZE,
    requestId = randomUUID(),
    sourceIp = "cli",
  } = {},
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

  // 1. Blank chunks (zero data, preserve length, bump version forward).
  const blank = await client.query(
    `UPDATE sector_chunks
        SET data = decode(repeat('00', octet_length(data)), 'hex'),
            version = version + 1,
            updated_at = now()
      WHERE sector_id = $1`,
    [sectorId],
  );
  const chunksBlanked = blank.rowCount ?? 0;

  // 2. Batched, resumable hard-delete of the event log.
  let eventsDeleted = 0;
  for (;;) {
    const del = await client.query(
      `DELETE FROM pixel_events
        WHERE id IN (
          SELECT id FROM pixel_events WHERE sector_id = $1 ORDER BY id LIMIT $2
        )`,
      [sectorId, batchSize],
    );
    const n = del.rowCount ?? 0;
    eventsDeleted += n;
    if (n === 0) break;
  }

  // 3. Audit.
  await writeAudit(client, {
    requestId,
    action: "reset_sector_pixels",
    actorKind: "ADMIN_ACCOUNT",
    targetId: sectorId,
    payload: {
      actor_owner_id: actor.id,
      actor_email: actor.email,
      chunks_blanked: chunksBlanked,
      events_deleted: eventsDeleted,
    },
    sourceIp,
  });

  return { chunksBlanked, eventsDeleted };
}

const USAGE = `Usage:
  node scripts/admin/reset-sector-pixels.mjs --sector <id> --actor <email> [--actor-id <id>] [--batch-size <n>] [--yes]`;

async function main() {
  await import("dotenv/config");
  const args = process.argv.slice(2);
  const sectorId = flagValue(args, "--sector");
  const email = flagValue(args, "--actor");
  const ownerId = flagValue(args, "--actor-id");
  const batchRaw = flagValue(args, "--batch-size");
  const batchSize = batchRaw ? Number(batchRaw) : undefined;
  const yes = args.includes("--yes");

  if (!sectorId || (!email && !ownerId) || (batchRaw && !(batchSize > 0))) {
    console.error(USAGE);
    process.exit(2);
  }

  const client = makeClient(process.env.DATABASE_URL);
  await client.connect();
  try {
    const branch = process.env.NEON_BRANCH_NAME ?? "(unknown)";
    const counts = await client.query(
      `SELECT (SELECT count(*)::int FROM pixel_events WHERE sector_id = $1) AS events,
              (SELECT count(*)::int FROM sector_chunks WHERE sector_id = $1) AS chunks`,
      [sectorId],
    );
    const { events, chunks } = counts.rows[0];
    console.error(
      `\n⚠️  PERMANENTLY resetting pixels for sector "${sectorId}" on branch "${branch}":\n` +
        `    blanking ${chunks} chunks + hard-deleting ${events} pixel_events. This is IRREVERSIBLE.\n`,
    );
    if (!yes && !(await confirmRetype(sectorId))) {
      console.error("confirmation mismatch — aborting.");
      process.exit(3);
    }
    const res = await resetSectorPixels(client, { sectorId, email, ownerId, batchSize });
    // Reclaim space from the deleted tuples. VACUUM cannot run inside a
    // transaction; the reset uses autocommit ops, so this is safe here.
    console.error("running VACUUM (ANALYZE) pixel_events …");
    await client.query("VACUUM (ANALYZE) pixel_events");
    console.log(JSON.stringify({ reset: "pixels", sector: sectorId, ...res }, null, 2));
  } catch (err) {
    const code = err?.code ? `[${err.code}] ` : "";
    console.error(`reset-sector-pixels failed: ${code}${err?.message ?? err}`);
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

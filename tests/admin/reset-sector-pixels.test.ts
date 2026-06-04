// Integration tests for the pixel reset CLI logic. Real Postgres;
// skipped when DATABASE_URL is unset. Seeds a sector with non-zero
// chunks + pixel_events and asserts: chunks blanked, version bumped
// FORWARD, events hard-deleted (batched + resumable), audit row.

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetSectorPixels } from "@/scripts/admin/reset-sector-pixels.mjs";
import { makeClient } from "@/scripts/admin/_common.mjs";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const d = HAS_DB ? describe : describe.skip;
const CHUNK_BYTES = 100 * 100; // mirrors src/pixels CHUNK_SIZE

d("resetSectorPixels CLI logic", () => {
  let client: import("pg").Client;
  const sectors: string[] = [];
  const owners: string[] = [];

  beforeAll(async () => {
    client = makeClient(process.env.DATABASE_URL);
    await client.connect();
  });

  afterAll(async () => {
    for (const s of sectors) {
      await client.query("DELETE FROM pixel_events WHERE sector_id = $1", [s]);
      await client.query("DELETE FROM sector_chunks WHERE sector_id = $1", [s]);
      await client.query("DELETE FROM sectors WHERE id = $1", [s]);
    }
    if (sectors.length) {
      await client.query("DELETE FROM admin_audit_events WHERE target_id = ANY($1)", [sectors]);
    }
    if (owners.length) {
      await client.query(
        "DELETE FROM bot_api_keys WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ANY($1))",
        [owners],
      );
      await client.query("DELETE FROM bots WHERE owner_id = ANY($1)", [owners]);
      await client.query("DELETE FROM owners WHERE id = ANY($1)", [owners]);
    }
    await client.end();
  });

  async function seed({
    chunks = 2,
    events = 4,
    chunkVersion = 5,
    actorIsAdmin = true,
  }: {
    chunks?: number;
    events?: number;
    chunkVersion?: number;
    actorIsAdmin?: boolean;
  } = {}): Promise<{ sectorId: string; ownerId: string }> {
    const sectorId = `rsp-${randomUUID().slice(0, 8)}`;
    const ownerId = `owner-${randomUUID().slice(0, 8)}`;
    const botId = `bot-${randomUUID().slice(0, 8)}`;
    const keyId = `key-${randomUUID().slice(0, 8)}`;
    sectors.push(sectorId);
    owners.push(ownerId);

    await client.query(
      "INSERT INTO sectors (id, name, width, height, palette_version, created_at) VALUES ($1, $1, 1000, 1000, 1, now())",
      [sectorId],
    );
    await client.query(
      "INSERT INTO owners (id, google_sub, email, display_name, is_admin, created_at) VALUES ($1, $2, $3, 'Test Owner', $4, now())",
      [ownerId, `dev-${ownerId}`, `${ownerId}@test.local`, actorIsAdmin],
    );
    await client.query(
      "INSERT INTO bots (id, owner_id, handle, display_name, status, created_at) VALUES ($1, $2, $3, $3, 'ACTIVE', now())",
      [botId, ownerId, `h-${randomUUID().slice(0, 8).toLowerCase()}`],
    );
    await client.query(
      "INSERT INTO bot_api_keys (id, bot_id, key_hash, prefix, created_at) VALUES ($1, $2, $3, 'bp_live_x', now())",
      [keyId, botId, `hash-${randomUUID()}`],
    );

    const nonZero = Buffer.alloc(CHUNK_BYTES, 7); // fill with palette index 7
    for (let i = 0; i < chunks; i++) {
      await client.query(
        "INSERT INTO sector_chunks (sector_id, chunk_x, chunk_y, data, version, updated_at) VALUES ($1, $2, 0, $3, $4, now())",
        [sectorId, i, nonZero, chunkVersion],
      );
    }
    for (let e = 0; e < events; e++) {
      await client.query(
        `INSERT INTO pixel_events
           (request_id, sector_id, x, y, color, palette_version, bot_id, api_key_id, chunk_version_after, created_at)
         VALUES ($1, $2, $3, 0, 3, 1, $4, $5, 1, now())`,
        [randomUUID(), sectorId, e, botId, keyId],
      );
    }
    return { sectorId, ownerId };
  }

  it("blanks chunks (zero data, version+1), deletes events, audits counts", async () => {
    const { sectorId, ownerId } = await seed({ chunks: 2, events: 4, chunkVersion: 5 });
    const requestId = randomUUID();

    const res = await resetSectorPixels(client, {
      sectorId,
      ownerId,
      requestId,
      sourceIp: "cli",
    });

    expect(res.chunksBlanked).toBe(2);
    expect(res.eventsDeleted).toBe(4);

    const chunkRows = await client.query(
      "SELECT data, version FROM sector_chunks WHERE sector_id = $1",
      [sectorId],
    );
    expect(chunkRows.rows).toHaveLength(2);
    for (const row of chunkRows.rows) {
      // all bytes zero
      expect(Buffer.compare(row.data, Buffer.alloc(row.data.length, 0))).toBe(0);
      // version bumped FORWARD, never reset to 0
      expect(Number(row.version)).toBe(6);
    }

    const ev = await client.query(
      "SELECT count(*)::int AS c FROM pixel_events WHERE sector_id = $1",
      [sectorId],
    );
    expect(ev.rows[0].c).toBe(0);

    const audit = await client.query(
      "SELECT action, actor_kind, target_id, payload_json FROM admin_audit_events WHERE request_id = $1",
      [requestId],
    );
    expect(audit.rows[0]).toMatchObject({
      action: "reset_sector_pixels",
      actor_kind: "ADMIN_ACCOUNT",
      target_id: sectorId,
    });
    expect(audit.rows[0].payload_json).toMatchObject({
      chunks_blanked: 2,
      events_deleted: 4,
    });
  });

  it("batched delete is resumable — tiny batchSize finishes, re-run is a no-op", async () => {
    const { sectorId, ownerId } = await seed({ chunks: 1, events: 5, chunkVersion: 2 });

    const first = await resetSectorPixels(client, { sectorId, ownerId, batchSize: 2 });
    expect(first.eventsDeleted).toBe(5);

    const evAfter = await client.query(
      "SELECT count(*)::int AS c FROM pixel_events WHERE sector_id = $1",
      [sectorId],
    );
    expect(evAfter.rows[0].c).toBe(0);

    // Re-running is safe + idempotent (no events left to delete).
    const second = await resetSectorPixels(client, { sectorId, ownerId, batchSize: 2 });
    expect(second.eventsDeleted).toBe(0);
  });

  it("refuses a non-admin actor and changes nothing", async () => {
    const { sectorId, ownerId } = await seed({
      chunks: 1,
      events: 2,
      chunkVersion: 3,
      actorIsAdmin: false,
    });

    await expect(
      resetSectorPixels(client, { sectorId, ownerId }),
    ).rejects.toMatchObject({ code: "actor_not_admin" });

    const ev = await client.query(
      "SELECT count(*)::int AS c FROM pixel_events WHERE sector_id = $1",
      [sectorId],
    );
    expect(ev.rows[0].c).toBe(2);
    const chunk = await client.query(
      "SELECT version FROM sector_chunks WHERE sector_id = $1",
      [sectorId],
    );
    expect(Number(chunk.rows[0].version)).toBe(3); // untouched
  });

  it("rejects an unknown sector (after the admin check passes)", async () => {
    const { ownerId } = await seed({ chunks: 0, events: 0 });
    await expect(
      resetSectorPixels(client, {
        sectorId: `missing-${randomUUID().slice(0, 8)}`,
        ownerId,
      }),
    ).rejects.toMatchObject({ code: "sector_not_found" });
  });

  it("handles an empty sector — 0/0, audit row still written", async () => {
    const { sectorId, ownerId } = await seed({ chunks: 0, events: 0 });
    const requestId = randomUUID();
    const res = await resetSectorPixels(client, { sectorId, ownerId, requestId });
    expect(res).toMatchObject({ chunksBlanked: 0, eventsDeleted: 0 });
    const audit = await client.query(
      "SELECT action FROM admin_audit_events WHERE request_id = $1",
      [requestId],
    );
    expect(audit.rows).toHaveLength(1);
  });
});

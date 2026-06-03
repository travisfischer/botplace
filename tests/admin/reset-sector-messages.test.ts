// Integration tests for the message-board reset CLI logic. Real
// Postgres; skipped when DATABASE_URL is unset. Seeds a sector with a
// bot-authored post/reply graph and asserts the hard-delete + audit.

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetSectorMessages } from "@/scripts/admin/reset-sector-messages.mjs";
import { makeClient } from "@/scripts/admin/_common.mjs";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const d = HAS_DB ? describe : describe.skip;

d("resetSectorMessages CLI logic", () => {
  let client: import("pg").Client;
  const sectors: string[] = [];
  const owners: string[] = [];

  beforeAll(async () => {
    client = makeClient(process.env.DATABASE_URL);
    await client.connect();
  });

  afterAll(async () => {
    for (const s of sectors) {
      await client.query("DELETE FROM replies WHERE sector_id = $1", [s]);
      await client.query("DELETE FROM posts WHERE sector_id = $1", [s]);
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
    posts = 2,
    repliesPerPost = 2,
    actorIsAdmin = true,
  }: { posts?: number; repliesPerPost?: number; actorIsAdmin?: boolean } = {}): Promise<{
    sectorId: string;
    ownerId: string;
  }> {
    const sectorId = `rsm-${randomUUID().slice(0, 8)}`;
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
    for (let p = 0; p < posts; p++) {
      const postRes = await client.query(
        "INSERT INTO posts (sector_id, bot_id, api_key_id, title, body, created_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id",
        [sectorId, botId, keyId, `title ${p}`, `body ${p}`],
      );
      const postId = postRes.rows[0].id;
      for (let r = 0; r < repliesPerPost; r++) {
        await client.query(
          "INSERT INTO replies (post_id, sector_id, bot_id, api_key_id, body, created_at) VALUES ($1, $2, $3, $4, $5, now())",
          [postId, sectorId, botId, keyId, `reply ${p}-${r}`],
        );
      }
    }
    return { sectorId, ownerId };
  }

  it("hard-deletes all posts+replies for the sector and audits the counts", async () => {
    const { sectorId, ownerId } = await seed({ posts: 2, repliesPerPost: 3 });
    const requestId = randomUUID();

    const res = await resetSectorMessages(client, {
      sectorId,
      ownerId,
      requestId,
      sourceIp: "cli",
    });

    expect(res.postsDeleted).toBe(2);
    expect(res.repliesDeleted).toBe(6);

    const p = await client.query("SELECT count(*)::int AS c FROM posts WHERE sector_id = $1", [
      sectorId,
    ]);
    const r = await client.query("SELECT count(*)::int AS c FROM replies WHERE sector_id = $1", [
      sectorId,
    ]);
    expect(p.rows[0].c).toBe(0);
    expect(r.rows[0].c).toBe(0);

    const audit = await client.query(
      "SELECT action, actor_kind, target_id, payload_json FROM admin_audit_events WHERE request_id = $1",
      [requestId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      action: "reset_sector_messages",
      actor_kind: "ADMIN_ACCOUNT",
      target_id: sectorId,
    });
    expect(audit.rows[0].payload_json).toMatchObject({
      posts_deleted: 2,
      replies_deleted: 6,
    });
  });

  it("refuses a non-admin actor and deletes nothing", async () => {
    const { sectorId, ownerId } = await seed({
      posts: 1,
      repliesPerPost: 1,
      actorIsAdmin: false,
    });

    await expect(
      resetSectorMessages(client, { sectorId, ownerId }),
    ).rejects.toMatchObject({ code: "actor_not_admin" });

    const p = await client.query("SELECT count(*)::int AS c FROM posts WHERE sector_id = $1", [
      sectorId,
    ]);
    expect(p.rows[0].c).toBe(1);
  });
});

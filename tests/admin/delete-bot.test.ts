// Integration tests for the bot-delete CLI logic. Real Postgres;
// skipped when DATABASE_URL is unset. Seeds a bot with controllable
// child counts (api keys, pixel_events, posts, replies) and asserts:
// happy-path delete, refuses when any audit-relevant child exists,
// refuses non-admin actors, idempotent end-state.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteBot } from "@/scripts/admin/delete-bot.mjs";
import { makeClient } from "@/scripts/admin/_common.mjs";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const d = HAS_DB ? describe : describe.skip;

d("deleteBot CLI logic", () => {
  let client: import("pg").Client;
  const sectors: string[] = [];
  const owners: string[] = [];
  const bots: string[] = [];

  beforeAll(async () => {
    client = makeClient(process.env.DATABASE_URL);
    await client.connect();
  });

  afterAll(async () => {
    // Anything the tests left behind. Order matters for FK Restrict.
    if (bots.length) {
      await client.query("DELETE FROM replies WHERE bot_id = ANY($1)", [bots]);
      await client.query("DELETE FROM posts WHERE bot_id = ANY($1)", [bots]);
      await client.query("DELETE FROM pixel_events WHERE bot_id = ANY($1)", [bots]);
      await client.query("DELETE FROM bot_api_keys WHERE bot_id = ANY($1)", [bots]);
      await client.query("DELETE FROM bots WHERE id = ANY($1)", [bots]);
      await client.query("DELETE FROM admin_audit_events WHERE target_id = ANY($1)", [bots]);
    }
    for (const s of sectors) {
      await client.query("DELETE FROM sector_chunks WHERE sector_id = $1", [s]);
      await client.query("DELETE FROM sectors WHERE id = $1", [s]);
    }
    if (owners.length) {
      await client.query("DELETE FROM owners WHERE id = ANY($1)", [owners]);
    }
    await client.end();
  });

  async function seed({
    actorIsAdmin = true,
    keys = 1,
    pixelEvents = 0,
    posts = 0,
    replies = 0,
  }: {
    actorIsAdmin?: boolean;
    keys?: number;
    pixelEvents?: number;
    posts?: number;
    replies?: number;
  } = {}): Promise<{ botId: string; handle: string; ownerId: string; keyIds: string[] }> {
    const ownerId = `owner-${randomUUID().slice(0, 8)}`;
    const botId = `bot-${randomUUID().slice(0, 8)}`;
    const handle = `h-${randomUUID().slice(0, 8).toLowerCase()}`;
    owners.push(ownerId);
    bots.push(botId);

    await client.query(
      "INSERT INTO owners (id, google_sub, email, display_name, is_admin, created_at) VALUES ($1, $2, $3, 'Test Owner', $4, now())",
      [ownerId, `dev-${ownerId}`, `${ownerId}@test.local`, actorIsAdmin],
    );
    await client.query(
      "INSERT INTO bots (id, owner_id, handle, display_name, status, created_at) VALUES ($1, $2, $3, $3, 'ACTIVE', now())",
      [botId, ownerId, handle],
    );

    const keyIds: string[] = [];
    for (let i = 0; i < keys; i++) {
      const keyId = `key-${randomUUID().slice(0, 8)}`;
      keyIds.push(keyId);
      await client.query(
        "INSERT INTO bot_api_keys (id, bot_id, key_hash, prefix, created_at) VALUES ($1, $2, $3, 'bp_live_x', now())",
        [keyId, botId, `hash-${randomUUID()}`],
      );
    }

    if (pixelEvents > 0 || posts > 0 || replies > 0) {
      // Need a sector for any of these. Reuse one shared sector per
      // suite if we already created one, otherwise mint a fresh one.
      let sectorId = sectors[0];
      if (!sectorId) {
        sectorId = `dbs-${randomUUID().slice(0, 8)}`;
        sectors.push(sectorId);
        await client.query(
          "INSERT INTO sectors (id, name, width, height, palette_version, created_at) VALUES ($1, $1, 100, 100, 1, now())",
          [sectorId],
        );
      }
      const primaryKey = keyIds[0];
      for (let e = 0; e < pixelEvents; e++) {
        await client.query(
          `INSERT INTO pixel_events
             (request_id, sector_id, x, y, color, palette_version, bot_id, api_key_id, chunk_version_after, created_at)
           VALUES ($1, $2, $3, 0, 3, 1, $4, $5, 1, now())`,
          [randomUUID(), sectorId, e, botId, primaryKey],
        );
      }
      for (let p = 0; p < posts; p++) {
        await client.query(
          `INSERT INTO posts
             (sector_id, bot_id, api_key_id, title, body, created_at)
           VALUES ($1, $2, $3, $4, 'b', now())`,
          [sectorId, botId, primaryKey, `t-${p}`],
        );
      }
      // Replies need a post. Mint one authored by a SEPARATE host bot
      // so the bot-under-test's post count stays at the requested
      // value — otherwise asserting `code: bot_has_replies` is
      // impossible (the posts check fires first).
      if (replies > 0) {
        const hostOwnerId = `host-${randomUUID().slice(0, 8)}`;
        const hostBotId = `host-bot-${randomUUID().slice(0, 8)}`;
        const hostKeyId = `host-key-${randomUUID().slice(0, 8)}`;
        owners.push(hostOwnerId);
        bots.push(hostBotId);
        await client.query(
          "INSERT INTO owners (id, google_sub, email, display_name, created_at) VALUES ($1, $2, $3, 'Host Owner', now())",
          [hostOwnerId, `dev-${hostOwnerId}`, `${hostOwnerId}@test.local`],
        );
        await client.query(
          "INSERT INTO bots (id, owner_id, handle, display_name, status, created_at) VALUES ($1, $2, $3, $3, 'ACTIVE', now())",
          [hostBotId, hostOwnerId, `host-${randomUUID().slice(0, 8).toLowerCase()}`],
        );
        await client.query(
          "INSERT INTO bot_api_keys (id, bot_id, key_hash, prefix, created_at) VALUES ($1, $2, $3, 'bp_live_x', now())",
          [hostKeyId, hostBotId, `hash-${randomUUID()}`],
        );
        const anchor = await client.query(
          `INSERT INTO posts (sector_id, bot_id, api_key_id, title, body, created_at)
             VALUES ($1, $2, $3, 'anchor', 'a', now()) RETURNING id`,
          [sectorId, hostBotId, hostKeyId],
        );
        const postId = anchor.rows[0].id;
        for (let r = 0; r < replies; r++) {
          await client.query(
            `INSERT INTO replies
               (post_id, sector_id, bot_id, api_key_id, body, created_at)
             VALUES ($1, $2, $3, $4, $5, now())`,
            [postId, sectorId, botId, primaryKey, `r-${r}`],
          );
        }
      }
    }

    return { botId, handle, ownerId, keyIds };
  }

  it("deletes a bot with zero children, by handle, writes the audit", async () => {
    const { botId, handle, ownerId } = await seed({ keys: 2 });
    const requestId = randomUUID();

    const res = await deleteBot(client, {
      bot: handle,
      ownerId,
      requestId,
    });

    expect(res).toEqual({ bot: { id: botId, handle }, keysDeleted: 2 });

    const botGone = await client.query("SELECT count(*)::int AS c FROM bots WHERE id = $1", [botId]);
    expect(botGone.rows[0].c).toBe(0);
    const keysGone = await client.query(
      "SELECT count(*)::int AS c FROM bot_api_keys WHERE bot_id = $1",
      [botId],
    );
    expect(keysGone.rows[0].c).toBe(0);

    const audit = await client.query(
      "SELECT action, actor_kind, target_id, payload_json FROM admin_audit_events WHERE request_id = $1",
      [requestId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      action: "delete_bot",
      actor_kind: "ADMIN_ACCOUNT",
      target_id: botId,
    });
    expect(audit.rows[0].payload_json).toMatchObject({
      handle,
      keys_deleted: 2,
      status: "ACTIVE",
      rate_tier: "FREE",
    });
  });

  it("deletes by id when no handle match is found", async () => {
    const { botId, ownerId } = await seed({ keys: 0 });
    const res = await deleteBot(client, { bot: botId, ownerId });
    expect(res.bot.id).toBe(botId);
    const gone = await client.query("SELECT count(*)::int AS c FROM bots WHERE id = $1", [botId]);
    expect(gone.rows[0].c).toBe(0);
  });

  it("refuses when pixel_events > 0 and changes nothing", async () => {
    const { botId, handle, ownerId } = await seed({ keys: 1, pixelEvents: 3 });

    await expect(
      deleteBot(client, { bot: handle, ownerId }),
    ).rejects.toMatchObject({ code: "bot_has_pixel_events" });

    const still = await client.query("SELECT count(*)::int AS c FROM bots WHERE id = $1", [botId]);
    expect(still.rows[0].c).toBe(1);
    const keys = await client.query(
      "SELECT count(*)::int AS c FROM bot_api_keys WHERE bot_id = $1",
      [botId],
    );
    expect(keys.rows[0].c).toBe(1);
    const audit = await client.query(
      "SELECT count(*)::int AS c FROM admin_audit_events WHERE target_id = $1",
      [botId],
    );
    expect(audit.rows[0].c).toBe(0);
  });

  it("refuses when posts > 0", async () => {
    const { handle, ownerId } = await seed({ posts: 2 });
    await expect(
      deleteBot(client, { bot: handle, ownerId }),
    ).rejects.toMatchObject({ code: "bot_has_posts" });
  });

  it("refuses when replies > 0", async () => {
    const { handle, ownerId } = await seed({ replies: 1 });
    await expect(
      deleteBot(client, { bot: handle, ownerId }),
    ).rejects.toMatchObject({ code: "bot_has_replies" });
  });

  it("refuses an unknown bot value", async () => {
    const { ownerId } = await seed({ keys: 0 });
    await expect(
      deleteBot(client, { bot: `missing-${randomUUID().slice(0, 8)}`, ownerId }),
    ).rejects.toMatchObject({ code: "bot_not_found" });
  });

  it("refuses a non-admin actor (no mutation, no audit)", async () => {
    const { botId, handle, ownerId } = await seed({ keys: 1, actorIsAdmin: false });

    await expect(
      deleteBot(client, { bot: handle, ownerId }),
    ).rejects.toMatchObject({ code: "actor_not_admin" });

    const still = await client.query("SELECT count(*)::int AS c FROM bots WHERE id = $1", [botId]);
    expect(still.rows[0].c).toBe(1);
    const audit = await client.query(
      "SELECT count(*)::int AS c FROM admin_audit_events WHERE target_id = $1",
      [botId],
    );
    expect(audit.rows[0].c).toBe(0);
  });

  it("second invocation is bot_not_found (idempotent end-state)", async () => {
    const { handle, ownerId } = await seed({ keys: 1 });
    await deleteBot(client, { bot: handle, ownerId });
    await expect(
      deleteBot(client, { bot: handle, ownerId }),
    ).rejects.toMatchObject({ code: "bot_not_found" });
  });

  // Script-level regression: --dry-run must enforce the admin check
  // BEFORE printing any preview. The bug was that the early-return
  // dry-run path skipped requireAdminActor, leaking
  // owner_id/display_name/counts to a non-admin caller. Covered as a
  // spawn-the-script test because the dry-run branch lives in main(),
  // not in the exported deleteBot().
  it("CLI --dry-run refuses a non-admin actor (does not print preview)", async () => {
    const { handle, ownerId } = await seed({ keys: 1, actorIsAdmin: false });

    const scriptPath = resolve(__dirname, "../../scripts/admin/delete-bot.mjs");
    const result = spawnSync(
      process.execPath,
      [scriptPath, "--bot", handle, "--actor-id", ownerId, "--dry-run"],
      {
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("actor_not_admin");
    // The preview JSON has these keys; none should appear in either stream.
    expect(result.stdout).not.toContain("dryRun");
    expect(result.stdout).not.toContain("display_name");
    expect(result.stdout).not.toContain("bot_api_keys");
  });
});

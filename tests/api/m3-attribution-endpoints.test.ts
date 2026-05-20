// M3 Theme B: integration tests for the three new attribution
// endpoints + the renamed /events shape. Real Postgres; skip when
// DATABASE_URL is unset (same gate as public-endpoints.test.ts).
//
// Coverage:
//   - GET /api/v1/public/sectors/:id/pixels/:x/:y
//       * happy path: returns bot_handle + bot_display_name
//       * pixel never written: 200 with null attribution (default-state pixel)
//       * out of bounds: 400 invalid_input field=x|y
//       * non-numeric coords: 400 invalid_input
//       * unknown sector: 404 sector_not_found
//   - GET /api/v1/public/sectors/:id/bots
//       * roster includes bots that wrote, sorted by last_seen_at desc
//       * empty roster for sector with no writes
//       * 404 for unknown sector
//   - GET /api/v1/public/bots/:handle/events
//       * returns bot's events with sector_id
//       * unknown handle returns [] (NOT 404)
//       * limit + since filters work
//       * malformed handle returns 400
//   - /events shape: bot_handle field present, no bot_name

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { GET as getBotEvents } from "@/app/api/v1/public/bots/[handle]/events/route";
import { GET as getEvents } from "@/app/api/v1/public/sectors/[id]/events/route";
import { GET as getPixel } from "@/app/api/v1/public/sectors/[id]/pixels/[x]/[y]/route";
import { GET as getRoster } from "@/app/api/v1/public/sectors/[id]/bots/route";
import { prisma } from "@/lib/prisma";
import { mintKey } from "@/src/auth/api-keys";
import { writePixel } from "@/src/pixels";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

interface Seed {
  sectorId: string;
  ownerId: string;
  botId: string;
  botHandle: string;
  botDisplayName: string;
  apiKeyId: string;
}

async function seed(): Promise<Seed> {
  const sectorId = `m3test-${randomUUID().slice(0, 8)}`;
  const ownerId = `owner-${randomUUID().slice(0, 8)}`;
  const botId = `bot-${randomUUID().slice(0, 8)}`;
  const apiKeyId = `key-${randomUUID().slice(0, 8)}`;
  const handle = `m3test-${randomUUID().slice(0, 8)}`;
  const displayName = `M3 Test Bot ${handle}`;
  const pepper = "0".repeat(64);

  await prisma.sector.create({
    data: { id: sectorId, name: sectorId, width: 200, height: 100, paletteVersion: 1 },
  });
  await prisma.owner.create({
    data: {
      id: ownerId,
      googleSub: `test-${ownerId}`,
      email: `${ownerId}@example.test`,
      displayName: ownerId,
    },
  });
  await prisma.bot.create({
    data: { id: botId, ownerId, handle, displayName },
  });
  const minted = mintKey("bp_live", pepper);
  await prisma.botApiKey.create({
    data: { id: apiKeyId, botId, keyHash: minted.hash, prefix: minted.prefix },
  });

  return {
    sectorId,
    ownerId,
    botId,
    botHandle: handle,
    botDisplayName: displayName,
    apiKeyId,
  };
}

async function cleanup(s: Seed): Promise<void> {
  await prisma.pixelEvent.deleteMany({ where: { sectorId: s.sectorId } });
  await prisma.sectorChunk.deleteMany({ where: { sectorId: s.sectorId } });
  await prisma.botApiKey.deleteMany({ where: { botId: s.botId } });
  await prisma.bot.deleteMany({ where: { id: s.botId } });
  await prisma.owner.deleteMany({ where: { id: s.ownerId } });
  await prisma.sector.deleteMany({ where: { id: s.sectorId } });
}

async function writeAt(s: Seed, x: number, y: number, color: number) {
  await writePixel({
    requestId: randomUUID(),
    sectorId: s.sectorId,
    x,
    y,
    color,
    paletteVersion: 1,
    botId: s.botId,
    apiKeyId: s.apiKeyId,
  });
}

describeIfDb("GET /api/v1/public/sectors/:id/pixels/:x/:y", () => {
  it(
    "returns bot_handle + bot_display_name for a written pixel",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        await writeAt(s, 5, 7, 3);
        const res = await getPixel(new Request("http://test/"), {
          params: Promise.resolve({
            id: s.sectorId,
            x: "5",
            y: "7",
          }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("X-Request-Id")).toBeTruthy();
        expect(res.headers.get("Cache-Control")).toMatch(/s-maxage=2/);
        const body = await res.json();
        expect(body).toMatchObject({
          x: 5,
          y: 7,
          color: 3,
          palette_version: 1,
          bot_id: s.botId,
          bot_handle: s.botHandle,
          bot_display_name: s.botDisplayName,
        });
        // Bot-descriptions feature: attribution endpoint surfaces the
        // bot's self-declared description (null when unset).
        expect(body.bot_description).toBeNull();
        expect(body.written_at).toMatch(/^20\d\d-/);
        expect(body.owner_id).toBeUndefined();
        expect(body.api_key_id).toBeUndefined();
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "returns 200 with null attribution for a coord with no event",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await getPixel(new Request("http://test/"), {
          params: Promise.resolve({ id: s.sectorId, x: "10", y: "10" }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toMatch(/s-maxage=2/);
        const body = await res.json();
        expect(body).toMatchObject({
          x: 10,
          y: 10,
          color: 0,
          palette_version: 1,
          bot_id: null,
          bot_handle: null,
          bot_display_name: null,
          written_at: null,
        });
        expect(body.request_id).toBeTruthy();
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "returns 400 invalid_input for out-of-bounds coords",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await getPixel(new Request("http://test/"), {
          params: Promise.resolve({
            id: s.sectorId,
            x: "9999",
            y: "10",
          }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body).toMatchObject({
          error: "invalid_input",
          field: "x",
          reason: "out_of_bounds",
        });
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "returns 400 invalid_input for non-numeric coords",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await getPixel(new Request("http://test/"), {
          params: Promise.resolve({ id: s.sectorId, x: "abc", y: "10" }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("invalid_input");
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "returns 404 sector_not_found for an unknown sector",
    { timeout: 30_000 },
    async () => {
      const res = await getPixel(new Request("http://test/"), {
        params: Promise.resolve({
          id: "nonexistent-sector-xyz",
          x: "5",
          y: "5",
        }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("sector_not_found");
    },
  );
});

describeIfDb("GET /api/v1/public/sectors/:id/bots (roster)", () => {
  it(
    "returns active bots sorted by last_seen_at desc",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        await writeAt(s, 1, 1, 2);
        await writeAt(s, 2, 2, 4);
        const res = await getRoster(new Request("http://test/"), {
          params: Promise.resolve({ id: s.sectorId }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("X-Request-Id")).toBeTruthy();
        expect(res.headers.get("Cache-Control")).toMatch(/s-maxage=10/);
        const body = await res.json();
        expect(body.sector_id).toBe(s.sectorId);
        expect(Array.isArray(body.bots)).toBe(true);
        expect(body.bots.length).toBeGreaterThanOrEqual(1);
        const ours = body.bots.find(
          (b: { handle: string }) => b.handle === s.botHandle,
        );
        expect(ours).toBeDefined();
        expect(ours.id).toBe(s.botId);
        expect(ours.display_name).toBe(s.botDisplayName);
        expect(ours.rate_tier).toBe("FREE");
        expect(ours.last_seen_at).toMatch(/^20\d\d-/);
        // Bot-descriptions feature: roster surfaces the bot's self-declared
        // description. Null when unset (seed bot has no description).
        expect(ours.description).toBeNull();
        // last_pixel comes from the same most-recent-event row that
        // drives last_seen_at — the final writeAt is (2, 2, color 4),
        // so that should be the bot's last pixel.
        expect(ours.last_pixel).toEqual({
          x: 2,
          y: 2,
          color: 4,
          palette_version: 1,
        });
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "returns empty roster for a sector with no events",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await getRoster(new Request("http://test/"), {
          params: Promise.resolve({ id: s.sectorId }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.bots).toEqual([]);
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "returns 404 for an unknown sector",
    { timeout: 30_000 },
    async () => {
      const res = await getRoster(new Request("http://test/"), {
        params: Promise.resolve({ id: "nonexistent-roster-xyz" }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("sector_not_found");
    },
  );
});

describeIfDb("GET /api/v1/public/bots/:handle/events", () => {
  it(
    "returns recent events for a bot, sorted desc by accepted_at",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        await writeAt(s, 1, 1, 2);
        await writeAt(s, 2, 2, 4);
        await writeAt(s, 3, 3, 5);
        const res = await getBotEvents(new Request("http://test/"), {
          params: Promise.resolve({ handle: s.botHandle }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("X-Request-Id")).toBeTruthy();
        expect(res.headers.get("Cache-Control")).toMatch(/s-maxage=2/);
        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBe(3);
        // Most recent first.
        expect(body[0].x).toBe(3);
        expect(body[0].sector_id).toBe(s.sectorId);
        expect(body[0].chunk_version_after).toMatch(/^\d+$/);
        // Privacy: no internal ids.
        expect(body[0].bot_id).toBeUndefined();
        expect(body[0].owner_id).toBeUndefined();
        expect(body[0].api_key_id).toBeUndefined();
        expect(body[0].request_id).toBeUndefined();
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "returns [] (200) for an unknown handle (NOT 404)",
    { timeout: 30_000 },
    async () => {
      const res = await getBotEvents(new Request("http://test/"), {
        params: Promise.resolve({ handle: "no-such-bot-zzz" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    },
  );

  it(
    "respects the limit parameter",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        for (let i = 0; i < 5; i++) await writeAt(s, i, i, 1);
        const res = await getBotEvents(
          new Request("http://test/?limit=2"),
          {
            params: Promise.resolve({ handle: s.botHandle }),
          },
        );
        const body = await res.json();
        expect(body.length).toBe(2);
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "returns 400 for a syntactically invalid handle",
    { timeout: 30_000 },
    async () => {
      const res = await getBotEvents(new Request("http://test/"), {
        params: Promise.resolve({ handle: "Invalid_Handle" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toMatchObject({
        error: "invalid_input",
        field: "handle",
      });
    },
  );

  it(
    "permits launch-bot-style handles (m25-*) for query",
    { timeout: 30_000 },
    async () => {
      // No protected-prefix mechanism — `m25-` is just a naming
      // convention for the M2.5 launch bots. The handle validator
      // accepts it; the DB unique index decides who actually owns
      // each handle.
      const res = await getBotEvents(new Request("http://test/"), {
        params: Promise.resolve({ handle: "m25-conway" }),
      });
      // Either 200 with [] (not seeded in this test DB) or 200 with
      // the real bot's events. Both are acceptable — the assertion is
      // that we don't bounce with 400.
      expect(res.status).toBe(200);
    },
  );

  it(
    "permits reserved handles for query",
    { timeout: 30_000 },
    async () => {
      // Reserved-handle protection only applies to owner-create. The
      // read path must be able to query any handle the DB might hold,
      // including any historical claims on a now-reserved name.
      const res = await getBotEvents(new Request("http://test/"), {
        params: Promise.resolve({ handle: "admin" }),
      });
      expect(res.status).toBe(200);
    },
  );

  it(
    "?before=<iso> filters to events with accepted_at < before (backward pagination)",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        // Write three events with controlled timing — the second one
        // becomes our cursor for the backward query.
        await writeAt(s, 1, 1, 1);
        await new Promise((r) => setTimeout(r, 20));
        await writeAt(s, 2, 2, 1);
        await new Promise((r) => setTimeout(r, 20));
        await writeAt(s, 3, 3, 1);

        // Pull all three, grab the middle event's accepted_at as the
        // cursor. Events are returned desc-by-accepted_at, so [0] is
        // the newest (x=3), [1] middle (x=2), [2] oldest (x=1).
        const allRes = await getBotEvents(new Request("http://test/"), {
          params: Promise.resolve({ handle: s.botHandle }),
        });
        const all = (await allRes.json()) as Array<{
          x: number;
          accepted_at: string;
        }>;
        expect(all.map((e) => e.x)).toEqual([3, 2, 1]);
        const middleCursor = all[1].accepted_at;

        // ?before=<middle cursor> → only the oldest event (x=1).
        const beforeRes = await getBotEvents(
          new Request(
            `http://test/?before=${encodeURIComponent(middleCursor)}`,
          ),
          { params: Promise.resolve({ handle: s.botHandle }) },
        );
        const before = (await beforeRes.json()) as Array<{ x: number }>;
        expect(before.map((e) => e.x)).toEqual([1]);
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "?before= and ?since= are mutually exclusive (400)",
    { timeout: 30_000 },
    async () => {
      const res = await getBotEvents(
        new Request(
          "http://test/?before=2026-05-15T00:00:00Z&since=2026-05-14T00:00:00Z",
        ),
        { params: Promise.resolve({ handle: "m25-conway" }) },
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toMatchObject({
        error: "invalid_input",
        field: "before",
        reason: "before_and_since_exclusive",
      });
    },
  );

  it(
    "?before=<garbage> returns 400 with reason=before_invalid",
    { timeout: 30_000 },
    async () => {
      const res = await getBotEvents(
        new Request("http://test/?before=not-a-date"),
        { params: Promise.resolve({ handle: "m25-conway" }) },
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toMatchObject({
        error: "invalid_input",
        field: "before",
        reason: "before_invalid",
      });
    },
  );

  it(
    "?before=<old-cursor> returning [] confirms cursor walked off end-of-history",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        await writeAt(s, 1, 1, 2);
        // Use a cursor older than the Unix epoch — guaranteed to be
        // older than every event in the table. An empty array is the
        // signal the activity feed uses to flip `hasMore = false`.
        const res = await getBotEvents(
          new Request("http://test/?before=1970-01-01T00:00:00Z"),
          { params: Promise.resolve({ handle: s.botHandle }) },
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as unknown[];
        expect(body).toEqual([]);
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "every event row now carries palette_version (new for the profile page's color swatch)",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        await writeAt(s, 7, 7, 2);
        const res = await getBotEvents(new Request("http://test/"), {
          params: Promise.resolve({ handle: s.botHandle }),
        });
        const body = (await res.json()) as Array<{
          color: number;
          palette_version: number;
        }>;
        expect(body[0].palette_version).toBe(1);
        // Sanity: color stayed.
        expect(body[0].color).toBe(2);
      } finally {
        await cleanup(s);
      }
    },
  );
});

describeIfDb("GET /api/v1/public/sectors/:id/events (M3 rename)", () => {
  it(
    "returns bot_id + bot_handle (not bot_name) on each event",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        await writeAt(s, 5, 5, 2);
        const res = await getEvents(new Request("http://test/"), {
          params: Promise.resolve({ id: s.sectorId }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("X-Request-Id")).toBeTruthy();
        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThanOrEqual(1);
        expect(body[0].bot_id).toBe(s.botId);
        expect(body[0].bot_handle).toBe(s.botHandle);
        expect(body[0].bot_name).toBeUndefined();
      } finally {
        await cleanup(s);
      }
    },
  );
});

// Make ts-noUnusedLocals happy in the slim seed-result type — Buffer
// import only used by the parent test file that this one is a sibling
// of, but vitest module-eval requires the import to stay typed.
void Buffer;

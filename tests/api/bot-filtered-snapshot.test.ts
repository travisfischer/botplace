// Integration tests for the bot-filtered snapshot endpoint at
// /api/v1/public/sectors/:id/bots/:handle/snapshot. Real Postgres;
// skip when DATABASE_URL is unset (same gate as M3 tests).
//
// Coverage:
//   - happy path: bot's pixels appear in the BPSS body, other bots'
//     pixels do not
//   - "currently authored" semantics: a pixel this bot wrote and was
//     later overwritten by another bot is absent from the snapshot
//   - empty case: bot with zero current-authored pixels returns a
//     well-formed (but chunk-less) snapshot
//   - unknown handle: 404
//   - unknown sector: 404
//   - 304 If-None-Match flow on the ETag we emit

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { GET as getSnapshot } from "@/app/api/v1/public/sectors/[id]/bots/[handle]/snapshot/route";
import { prisma } from "@/lib/prisma";
import { mintKey } from "@/src/auth/api-keys";
import { writePixel } from "@/src/pixels";
import { decodeSnapshot } from "@/src/viewer/snapshot";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

interface BotSeed {
  id: string;
  handle: string;
  apiKeyId: string;
}

interface Seed {
  sectorId: string;
  ownerId: string;
  botA: BotSeed;
  botB: BotSeed;
}

async function seedBot(ownerId: string): Promise<BotSeed> {
  const id = `bot-${randomUUID().slice(0, 8)}`;
  const apiKeyId = `key-${randomUUID().slice(0, 8)}`;
  const handle = `bfst-${randomUUID().slice(0, 8)}`;
  const pepper = "0".repeat(64);
  await prisma.bot.create({
    data: { id, ownerId, handle, displayName: `Test Bot ${handle}` },
  });
  const minted = mintKey("bp_live", pepper);
  await prisma.botApiKey.create({
    data: { id: apiKeyId, botId: id, keyHash: minted.hash, prefix: minted.prefix },
  });
  return { id, handle, apiKeyId };
}

async function seed(): Promise<Seed> {
  const sectorId = `bfs-${randomUUID().slice(0, 8)}`;
  const ownerId = `owner-${randomUUID().slice(0, 8)}`;
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
  const botA = await seedBot(ownerId);
  const botB = await seedBot(ownerId);
  return { sectorId, ownerId, botA, botB };
}

async function cleanup(s: Seed): Promise<void> {
  await prisma.pixelEvent.deleteMany({ where: { sectorId: s.sectorId } });
  await prisma.sectorChunk.deleteMany({ where: { sectorId: s.sectorId } });
  await prisma.botApiKey.deleteMany({
    where: { botId: { in: [s.botA.id, s.botB.id] } },
  });
  await prisma.bot.deleteMany({ where: { id: { in: [s.botA.id, s.botB.id] } } });
  await prisma.owner.deleteMany({ where: { id: s.ownerId } });
  await prisma.sector.deleteMany({ where: { id: s.sectorId } });
}

async function writeAt(s: Seed, bot: BotSeed, x: number, y: number, color: number) {
  await writePixel({
    requestId: randomUUID(),
    sectorId: s.sectorId,
    x,
    y,
    color,
    paletteVersion: 1,
    botId: bot.id,
    apiKeyId: bot.apiKeyId,
  });
}

async function fetchSnapshotBuffer(
  sectorId: string,
  handle: string,
  init: { ifNoneMatch?: string } = {},
): Promise<Response> {
  const headers: HeadersInit = {};
  if (init.ifNoneMatch) headers["If-None-Match"] = init.ifNoneMatch;
  return getSnapshot(new Request("http://test/", { headers }), {
    params: Promise.resolve({ id: sectorId, handle }),
  });
}

describeIfDb("GET /api/v1/public/sectors/:id/bots/:handle/snapshot", () => {
  it(
    "includes botA's pixels and excludes botB's pixels",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        await writeAt(s, s.botA, 5, 7, 3);
        await writeAt(s, s.botA, 6, 7, 4);
        await writeAt(s, s.botB, 50, 50, 5);

        const res = await fetchSnapshotBuffer(s.sectorId, s.botA.handle);
        expect(res.status).toBe(200);
        expect(res.headers.get("X-Filtered-Pixel-Count")).toBe("2");
        const buf = new Uint8Array(await res.arrayBuffer());
        const decoded = decodeSnapshot(buf);

        // BotA wrote in chunk (0, 0) only (5,7 and 6,7 are both in
        // CHUNK_SIZE=100). One chunk in the output.
        expect(decoded.chunks).toHaveLength(1);
        const chunk = decoded.chunks[0];
        expect(chunk.chunk_x).toBe(0);
        expect(chunk.chunk_y).toBe(0);
        // (5, 7) → byte offset 7 * 100 + 5 = 705 → color 3.
        expect(chunk.bytes[7 * 100 + 5]).toBe(3);
        // (6, 7) → byte offset 7 * 100 + 6 = 706 → color 4.
        expect(chunk.bytes[7 * 100 + 6]).toBe(4);
        // BotB's (50, 50) would land in the same chunk if it were
        // botA's — verify it isn't.
        expect(chunk.bytes[50 * 100 + 50]).toBe(0);
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "excludes a pixel botA wrote that botB later overwrote (currently-authored semantics)",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        await writeAt(s, s.botA, 1, 1, 3);
        // BotB overwrites the same coord.
        await writeAt(s, s.botB, 1, 1, 5);

        const res = await fetchSnapshotBuffer(s.sectorId, s.botA.handle);
        expect(res.status).toBe(200);
        expect(res.headers.get("X-Filtered-Pixel-Count")).toBe("0");
        const buf = new Uint8Array(await res.arrayBuffer());
        const decoded = decodeSnapshot(buf);
        expect(decoded.chunks).toHaveLength(0);
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "returns an empty snapshot for a bot with no current-authored pixels",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        await writeAt(s, s.botB, 1, 1, 5);

        const res = await fetchSnapshotBuffer(s.sectorId, s.botA.handle);
        expect(res.status).toBe(200);
        expect(res.headers.get("X-Filtered-Pixel-Count")).toBe("0");
        const buf = new Uint8Array(await res.arrayBuffer());
        const decoded = decodeSnapshot(buf);
        expect(decoded.chunks).toHaveLength(0);
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "returns 404 for an unknown handle (not the events endpoint's 200 [] stale-handle behavior)",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await fetchSnapshotBuffer(s.sectorId, "nope-not-a-bot");
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe("bot_not_found");
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "returns 404 for an unknown sector",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await fetchSnapshotBuffer("not-a-sector", s.botA.handle);
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe("sector_not_found");
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "respects If-None-Match with a 304 when the sector hasn't changed",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        await writeAt(s, s.botA, 5, 7, 3);

        const first = await fetchSnapshotBuffer(s.sectorId, s.botA.handle);
        expect(first.status).toBe(200);
        const etag = first.headers.get("ETag");
        expect(etag).toBeTruthy();

        const second = await fetchSnapshotBuffer(s.sectorId, s.botA.handle, {
          ifNoneMatch: etag!,
        });
        expect(second.status).toBe(304);
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "ETag busts when any bot writes to the sector",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        await writeAt(s, s.botA, 5, 7, 3);
        const first = await fetchSnapshotBuffer(s.sectorId, s.botA.handle);
        const firstEtag = first.headers.get("ETag");

        // An unrelated bot's write bumps the sector's max event id —
        // botA's snapshot ETag must change so the CDN doesn't serve
        // stale "still includes botA's overwritten pixel" data.
        await writeAt(s, s.botB, 99, 99, 4);

        const second = await fetchSnapshotBuffer(s.sectorId, s.botA.handle);
        expect(second.headers.get("ETag")).not.toBe(firstEtag);
      } finally {
        await cleanup(s);
      }
    },
  );
});

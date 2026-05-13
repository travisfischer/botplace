// Public read endpoints (V1 of M2 requirement) — integration test against
// real Postgres. Skips itself if DATABASE_URL is unset, same gate as the
// other DB-backed tests.
//
// Imports the route handlers directly rather than booting Next, so the
// request flow stays in-process. The handlers receive a real Request and
// return a real Response — same shape as production, no auth.
//
// Cleanup ordering matches replay.test.ts: pixel_events → sector_chunks →
// bot_api_keys → bots → owners → sectors.

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { GET as getSector } from "@/app/api/v1/public/sectors/[id]/route";
import { GET as getManifest } from "@/app/api/v1/public/sectors/[id]/manifest/route";
import { GET as getChunk } from "@/app/api/v1/public/sectors/[id]/chunks/[chunk_x]/[chunk_y]/route";
import { GET as getSnapshot } from "@/app/api/v1/public/sectors/[id]/snapshot/route";
import { prisma } from "@/lib/prisma";
import { mintKey } from "@/src/auth/api-keys";
import { CHUNK_BYTES, CHUNK_SIZE, writePixel } from "@/src/pixels";
import { decodeSnapshot } from "@/src/viewer/snapshot";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

interface SeedResult {
  sectorId: string;
  ownerId: string;
  botId: string;
  apiKeyId: string;
}

async function seedSector(width = 200, height = 100): Promise<SeedResult> {
  const sectorId = `pubtest-${randomUUID().slice(0, 8)}`;
  const ownerId = `owner-${randomUUID().slice(0, 8)}`;
  const botId = `bot-${randomUUID().slice(0, 8)}`;
  const apiKeyId = `key-${randomUUID().slice(0, 8)}`;
  const pepper = "0".repeat(64);

  await prisma.sector.create({
    data: {
      id: sectorId,
      name: sectorId,
      width,
      height,
      paletteVersion: 1,
    },
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
    data: { id: botId, ownerId, name: `bot-${randomUUID().slice(0, 4)}` },
  });
  const minted = mintKey("bp_live", pepper);
  await prisma.botApiKey.create({
    data: {
      id: apiKeyId,
      botId,
      keyHash: minted.hash,
      prefix: minted.prefix,
    },
  });

  return { sectorId, ownerId, botId, apiKeyId };
}

async function cleanup(seed: SeedResult): Promise<void> {
  await prisma.pixelEvent.deleteMany({ where: { sectorId: seed.sectorId } });
  await prisma.sectorChunk.deleteMany({ where: { sectorId: seed.sectorId } });
  await prisma.botApiKey.deleteMany({ where: { botId: seed.botId } });
  await prisma.bot.deleteMany({ where: { id: seed.botId } });
  await prisma.owner.deleteMany({ where: { id: seed.ownerId } });
  await prisma.sector.deleteMany({ where: { id: seed.sectorId } });
}

describeIfDb("GET /api/v1/public/sectors/:id", () => {
  it(
    "returns sector metadata with snake_case fields and Cache-Control",
    { timeout: 30_000 },
    async () => {
      const seed = await seedSector(200, 100);
      try {
        const res = await getSector(new Request("http://test/"), {
          params: Promise.resolve({ id: seed.sectorId }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
        expect(res.headers.get("CDN-Cache-Control")).toBe(
          "public, s-maxage=60, stale-while-revalidate=300",
        );
        const body = await res.json();
        expect(body).toMatchObject({
          id: seed.sectorId,
          width: 200,
          height: 100,
          palette_version: 1,
          default_color: 0,
          chunk_size: CHUNK_SIZE,
          chunks_x: 2,
          chunks_y: 1,
        });
        expect(Array.isArray(body.palette)).toBe(true);
        expect(body.palette.length).toBe(8);
      } finally {
        await cleanup(seed);
      }
    },
  );

  it("returns 404 for unknown sector", { timeout: 10_000 }, async () => {
    const res = await getSector(new Request("http://test/"), {
      params: Promise.resolve({ id: "no-such-sector-xyz" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("sector_not_found");
    expect(typeof body.request_id).toBe("string");
  });
});

describeIfDb("GET /api/v1/public/sectors/:id/manifest", () => {
  it(
    "omits unwritten chunks (Option A); includes written ones with stringified version",
    { timeout: 30_000 },
    async () => {
      const seed = await seedSector(200, 100);
      try {
        // No writes yet — manifest should be empty.
        let res = await getManifest(new Request("http://test/"), {
          params: Promise.resolve({ id: seed.sectorId }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
        expect(res.headers.get("CDN-Cache-Control")).toBe(
          "public, s-maxage=1, stale-while-revalidate=5",
        );
        let body = await res.json();
        expect(body).toEqual([]);

        // Write to chunk (0,0) and chunk (1,0). Manifest should now include
        // exactly those two, sorted (chunkY asc, chunkX asc).
        await writePixel({
          requestId: randomUUID(),
          sectorId: seed.sectorId,
          x: 5,
          y: 5,
          color: 1,
          paletteVersion: 1,
          botId: seed.botId,
          apiKeyId: seed.apiKeyId,
        });
        await writePixel({
          requestId: randomUUID(),
          sectorId: seed.sectorId,
          x: 105,
          y: 5,
          color: 2,
          paletteVersion: 1,
          botId: seed.botId,
          apiKeyId: seed.apiKeyId,
        });
        // Second write to (0,0) — version should be 2, not 1.
        await writePixel({
          requestId: randomUUID(),
          sectorId: seed.sectorId,
          x: 6,
          y: 5,
          color: 3,
          paletteVersion: 1,
          botId: seed.botId,
          apiKeyId: seed.apiKeyId,
        });

        res = await getManifest(new Request("http://test/"), {
          params: Promise.resolve({ id: seed.sectorId }),
        });
        expect(res.status).toBe(200);
        body = await res.json();
        expect(body.length).toBe(2);
        expect(body[0]).toMatchObject({
          chunk_x: 0,
          chunk_y: 0,
          version: "2",
        });
        expect(body[1]).toMatchObject({
          chunk_x: 1,
          chunk_y: 0,
          version: "1",
        });
        expect(typeof body[0].updated_at).toBe("string");
      } finally {
        await cleanup(seed);
      }
    },
  );

  it("returns 404 for unknown sector", { timeout: 10_000 }, async () => {
    const res = await getManifest(new Request("http://test/"), {
      params: Promise.resolve({ id: "no-such-sector-xyz" }),
    });
    expect(res.status).toBe(404);
  });
});

describeIfDb("GET /api/v1/public/sectors/:id/chunks/:cx/:cy", () => {
  it(
    "returns synthetic zero blob with ETag \"0\" for never-written chunks",
    { timeout: 30_000 },
    async () => {
      const seed = await seedSector(200, 100);
      try {
        const res = await getChunk(new Request("http://test/"), {
          params: Promise.resolve({
            id: seed.sectorId,
            chunk_x: "0",
            chunk_y: "0",
          }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(res.headers.get("ETag")).toBe('"0"');
        expect(res.headers.get("X-Chunk-Version")).toBe("0");
        expect(res.headers.get("X-Chunk-Updated-At")).toBeNull();
        expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
        expect(res.headers.get("CDN-Cache-Control")).toBe(
          "public, s-maxage=1, stale-while-revalidate=30",
        );
        const buf = Buffer.from(await res.arrayBuffer());
        expect(buf.length).toBe(CHUNK_BYTES);
        expect(buf.every((b) => b === 0)).toBe(true);
      } finally {
        await cleanup(seed);
      }
    },
  );

  it(
    "returns the actual chunk bytes with ETag matching version after a write",
    { timeout: 30_000 },
    async () => {
      const seed = await seedSector(200, 100);
      try {
        await writePixel({
          requestId: randomUUID(),
          sectorId: seed.sectorId,
          x: 7,
          y: 9,
          color: 5,
          paletteVersion: 1,
          botId: seed.botId,
          apiKeyId: seed.apiKeyId,
        });

        const res = await getChunk(new Request("http://test/"), {
          params: Promise.resolve({
            id: seed.sectorId,
            chunk_x: "0",
            chunk_y: "0",
          }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("ETag")).toBe('"1"');
        expect(res.headers.get("X-Chunk-Version")).toBe("1");
        expect(res.headers.get("X-Chunk-Updated-At")).not.toBeNull();
        const buf = Buffer.from(await res.arrayBuffer());
        expect(buf.length).toBe(CHUNK_BYTES);
        // (x=7, y=9) → byteOffset = 9*100 + 7 = 907.
        expect(buf[907]).toBe(5);
      } finally {
        await cleanup(seed);
      }
    },
  );

  it(
    "returns 304 when If-None-Match matches the current ETag",
    { timeout: 30_000 },
    async () => {
      const seed = await seedSector(200, 100);
      try {
        await writePixel({
          requestId: randomUUID(),
          sectorId: seed.sectorId,
          x: 0,
          y: 0,
          color: 1,
          paletteVersion: 1,
          botId: seed.botId,
          apiKeyId: seed.apiKeyId,
        });

        // First fetch to capture ETag.
        const first = await getChunk(new Request("http://test/"), {
          params: Promise.resolve({
            id: seed.sectorId,
            chunk_x: "0",
            chunk_y: "0",
          }),
        });
        const etag = first.headers.get("ETag");
        expect(etag).toBe('"1"');

        // If-None-Match should produce 304 with no body.
        const second = await getChunk(
          new Request("http://test/", {
            headers: { "If-None-Match": etag! },
          }),
          {
            params: Promise.resolve({
              id: seed.sectorId,
              chunk_x: "0",
              chunk_y: "0",
            }),
          },
        );
        expect(second.status).toBe(304);
        expect(second.headers.get("ETag")).toBe('"1"');
        const body = await second.arrayBuffer();
        expect(body.byteLength).toBe(0);
      } finally {
        await cleanup(seed);
      }
    },
  );

  it(
    "returns 304 when If-None-Match=\"0\" against a never-written chunk",
    { timeout: 30_000 },
    async () => {
      const seed = await seedSector(200, 100);
      try {
        const res = await getChunk(
          new Request("http://test/", {
            headers: { "If-None-Match": '"0"' },
          }),
          {
            params: Promise.resolve({
              id: seed.sectorId,
              chunk_x: "0",
              chunk_y: "0",
            }),
          },
        );
        expect(res.status).toBe(304);
      } finally {
        await cleanup(seed);
      }
    },
  );

  it("returns 400 out_of_bounds for off-grid chunk coordinates", { timeout: 10_000 }, async () => {
    const seed = await seedSector(200, 100);
    try {
      const res = await getChunk(new Request("http://test/"), {
        params: Promise.resolve({
          id: seed.sectorId,
          chunk_x: "5",
          chunk_y: "5",
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("out_of_bounds");
    } finally {
      await cleanup(seed);
    }
  });

  it("returns 404 for unknown sector", { timeout: 10_000 }, async () => {
    const res = await getChunk(new Request("http://test/"), {
      params: Promise.resolve({
        id: "no-such-sector-xyz",
        chunk_x: "0",
        chunk_y: "0",
      }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("sector_not_found");
  });
});

describeIfDb("GET /api/v1/public/sectors/:id/snapshot", () => {
  it(
    "returns an empty snapshot (header only) for a freshly seeded sector",
    { timeout: 30_000 },
    async () => {
      const seed = await seedSector(200, 100);
      try {
        const res = await getSnapshot(new Request("http://test/"), {
          params: Promise.resolve({ id: seed.sectorId }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
        expect(res.headers.get("CDN-Cache-Control")).toBe(
          "public, s-maxage=1, stale-while-revalidate=5",
        );
        expect(res.headers.get("ETag")).toBe('"snap-0"');
        expect(res.headers.get("X-Snapshot-Chunk-Count")).toBe("0");
        expect(res.headers.get("X-Snapshot-Max-Version")).toBe("0");
        const body = new Uint8Array(await res.arrayBuffer());
        expect(body.byteLength).toBe(16);
        const decoded = decodeSnapshot(body);
        expect(decoded.chunk_size).toBe(CHUNK_SIZE);
        expect(decoded.chunks).toEqual([]);
      } finally {
        await cleanup(seed);
      }
    },
  );

  it(
    "encodes every written chunk and bumps max-version with each write",
    { timeout: 30_000 },
    async () => {
      const seed = await seedSector(200, 100);
      try {
        await writePixel({
          requestId: randomUUID(),
          sectorId: seed.sectorId,
          x: 5,
          y: 5,
          color: 1,
          paletteVersion: 1,
          botId: seed.botId,
          apiKeyId: seed.apiKeyId,
        });
        await writePixel({
          requestId: randomUUID(),
          sectorId: seed.sectorId,
          x: 105,
          y: 5,
          color: 2,
          paletteVersion: 1,
          botId: seed.botId,
          apiKeyId: seed.apiKeyId,
        });
        // Bump (0,0) again so its version (2) differs from (1,0)'s (1)
        // and we can verify max-version is the larger of the two.
        await writePixel({
          requestId: randomUUID(),
          sectorId: seed.sectorId,
          x: 6,
          y: 5,
          color: 3,
          paletteVersion: 1,
          botId: seed.botId,
          apiKeyId: seed.apiKeyId,
        });

        const res = await getSnapshot(new Request("http://test/"), {
          params: Promise.resolve({ id: seed.sectorId }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("X-Snapshot-Chunk-Count")).toBe("2");
        expect(res.headers.get("X-Snapshot-Max-Version")).toBe("2");
        expect(res.headers.get("ETag")).toBe('"snap-2"');

        const body = new Uint8Array(await res.arrayBuffer());
        const decoded = decodeSnapshot(body);
        expect(decoded.chunk_size).toBe(CHUNK_SIZE);
        expect(decoded.chunks.length).toBe(2);
        // (chunkY asc, chunkX asc) → (0,0) before (1,0).
        const c00 = decoded.chunks[0];
        const c10 = decoded.chunks[1];
        expect(c00.chunk_x).toBe(0);
        expect(c00.chunk_y).toBe(0);
        expect(c00.version).toBe("2");
        expect(c00.bytes.length).toBe(CHUNK_BYTES);
        // (5,5) within chunk (0,0) → byteOffset = 5*100 + 5 = 505.
        expect(c00.bytes[505]).toBe(1);
        // (6,5) → byteOffset = 5*100 + 6 = 506.
        expect(c00.bytes[506]).toBe(3);

        expect(c10.chunk_x).toBe(1);
        expect(c10.chunk_y).toBe(0);
        expect(c10.version).toBe("1");
        // (105,5) → local (5,5) within chunk (1,0) → byteOffset 505.
        expect(c10.bytes[505]).toBe(2);
      } finally {
        await cleanup(seed);
      }
    },
  );

  it(
    "returns 304 when If-None-Match matches the current ETag",
    { timeout: 30_000 },
    async () => {
      const seed = await seedSector(200, 100);
      try {
        await writePixel({
          requestId: randomUUID(),
          sectorId: seed.sectorId,
          x: 0,
          y: 0,
          color: 1,
          paletteVersion: 1,
          botId: seed.botId,
          apiKeyId: seed.apiKeyId,
        });

        const first = await getSnapshot(new Request("http://test/"), {
          params: Promise.resolve({ id: seed.sectorId }),
        });
        const etag = first.headers.get("ETag");
        expect(etag).toBe('"snap-1"');

        const second = await getSnapshot(
          new Request("http://test/", {
            headers: { "If-None-Match": etag! },
          }),
          { params: Promise.resolve({ id: seed.sectorId }) },
        );
        expect(second.status).toBe(304);
        expect(second.headers.get("ETag")).toBe('"snap-1"');
        const body = await second.arrayBuffer();
        expect(body.byteLength).toBe(0);
      } finally {
        await cleanup(seed);
      }
    },
  );

  it("returns 404 for unknown sector", { timeout: 10_000 }, async () => {
    const res = await getSnapshot(new Request("http://test/"), {
      params: Promise.resolve({ id: "no-such-sector-xyz" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("sector_not_found");
    expect(typeof body.request_id).toBe("string");
  });
});

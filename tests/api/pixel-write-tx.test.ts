// Pixel-write transaction invariants. Complementary to replay.test.ts —
// the replay test proves the event log can reconstruct chunk state; this
// test proves the underlying transaction writes the right byte at the
// right offset, increments the version monotonically, and emits exactly
// one PixelEvent per call.
//
// Hits a real Postgres (the disposable Neon dev branch). Skips if
// `DATABASE_URL` is unset.

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mintKey } from "@/src/auth/api-keys";
import { CHUNK_SIZE, chunkAddressFor, writePixel } from "@/src/pixels";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

describeIfDb("writePixel transaction invariants", () => {
  it(
    "writes byte at the correct offset and bumps version monotonically",
    { timeout: 30_000 },
    async () => {
      const sectorId = `pwtx-${randomUUID().slice(0, 8)}`;
      const ownerId = `owner-${randomUUID().slice(0, 8)}`;
      const botId = `bot-${randomUUID().slice(0, 8)}`;
      const apiKeyId = `key-${randomUUID().slice(0, 8)}`;
      const pepper = "0".repeat(64);

      try {
        await prisma.sector.create({
          data: {
            id: sectorId,
            name: sectorId,
            width: 200,
            height: 100,
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
          data: {
            id: botId,
            ownerId,
            name: `bot-${randomUUID().slice(0, 4)}`,
          },
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

        // Three writes to (5, 5) — same pixel, same chunk. Version on the
        // chunk row should advance by exactly 3, the byte should equal the
        // last color, and there should be exactly 3 PixelEvent rows.
        const writes = [
          { x: 5, y: 5, color: 1 },
          { x: 5, y: 5, color: 2 },
          { x: 5, y: 5, color: 3 },
        ];
        let lastVersion = 0n;
        for (const w of writes) {
          const result = await writePixel({
            requestId: randomUUID(),
            sectorId,
            x: w.x,
            y: w.y,
            color: w.color,
            paletteVersion: 1,
            botId,
            apiKeyId,
          });
          // Strictly monotonic.
          expect(result.chunkVersion).toBeGreaterThan(lastVersion);
          lastVersion = result.chunkVersion;
        }

        const chunk = await prisma.sectorChunk.findUnique({
          where: {
            sectorId_chunkX_chunkY: { sectorId, chunkX: 0, chunkY: 0 },
          },
          select: { data: true, version: true },
        });
        expect(chunk).not.toBeNull();
        expect(chunk!.version).toBe(3n);

        const { byteOffset } = chunkAddressFor({ x: 5, y: 5 });
        // Last write wins.
        expect(Buffer.from(chunk!.data)[byteOffset]).toBe(3);

        // Exactly three event rows for this sector.
        const events = await prisma.pixelEvent.count({ where: { sectorId } });
        expect(events).toBe(3);

        // Event chunkVersionAfter is monotonic.
        const eventRows = await prisma.pixelEvent.findMany({
          where: { sectorId },
          select: { chunkVersionAfter: true },
          orderBy: { id: "asc" },
        });
        expect(eventRows.map((e) => e.chunkVersionAfter)).toEqual([
          1n,
          2n,
          3n,
        ]);
      } finally {
        await prisma.pixelEvent.deleteMany({ where: { sectorId } });
        await prisma.sectorChunk.deleteMany({ where: { sectorId } });
        await prisma.botApiKey.deleteMany({ where: { id: apiKeyId } });
        await prisma.bot.deleteMany({ where: { id: botId } });
        await prisma.owner.deleteMany({ where: { id: ownerId } });
        await prisma.sector.deleteMany({ where: { id: sectorId } });
      }
    },
  );

  it(
    "writes to different chunks are independent (no cross-chunk state)",
    { timeout: 30_000 },
    async () => {
      const sectorId = `pwtx2-${randomUUID().slice(0, 8)}`;
      const ownerId = `owner-${randomUUID().slice(0, 8)}`;
      const botId = `bot-${randomUUID().slice(0, 8)}`;
      const apiKeyId = `key-${randomUUID().slice(0, 8)}`;
      const pepper = "0".repeat(64);

      try {
        await prisma.sector.create({
          data: {
            id: sectorId,
            name: sectorId,
            width: 300,
            height: 100,
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

        // (50, 50) is in chunk (0, 0); (150, 50) is in chunk (1, 0); (250, 50)
        // is in chunk (2, 0). Each chunk's version should be 1 after one write.
        for (const x of [50, 150, 250]) {
          await writePixel({
            requestId: randomUUID(),
            sectorId,
            x,
            y: 50,
            color: 4,
            paletteVersion: 1,
            botId,
            apiKeyId,
          });
        }

        const chunks = await prisma.sectorChunk.findMany({
          where: { sectorId },
          select: { chunkX: true, version: true },
          orderBy: { chunkX: "asc" },
        });
        expect(chunks.map((c) => c.chunkX)).toEqual([0, 1, 2]);
        expect(chunks.map((c) => c.version)).toEqual([1n, 1n, 1n]);
      } finally {
        await prisma.pixelEvent.deleteMany({ where: { sectorId } });
        await prisma.sectorChunk.deleteMany({ where: { sectorId } });
        await prisma.botApiKey.deleteMany({ where: { id: apiKeyId } });
        await prisma.bot.deleteMany({ where: { id: botId } });
        await prisma.owner.deleteMany({ where: { id: ownerId } });
        await prisma.sector.deleteMany({ where: { id: sectorId } });
      }
    },
  );
});

describe("pixel-write-tx test invariants", () => {
  it("CHUNK_SIZE is 100 (test fixtures assume this)", () => {
    expect(CHUNK_SIZE).toBe(100);
  });
});

// Replay test: writes a small batch of pixels through the real `writePixel`
// path, replays the recorded `PixelEvent` rows ordered by `(sectorId, id)
// ASC`, reconstructs chunk byte arrays in memory, and byte-compares them
// against the live `SectorChunk.data`. The append-only event log is the
// system's audit story; this test enforces that it actually reproduces the
// canvas state.
//
// Hits a real Postgres (the disposable Neon dev branch). Skips itself if
// `DATABASE_URL` is unset so contributors without a DB don't see a hard
// failure on `pnpm test`.
//
// Cleanup ordering matters because of the Restrict cascade policy:
//   pixel_events → sector_chunks → bot_api_keys → bots → owners → sectors

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mintKey } from "@/src/auth/api-keys";
import {
  CHUNK_BYTES,
  CHUNK_SIZE,
  chunkAddressFor,
  writePixel,
} from "@/src/pixels";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

describeIfDb("event-log replay reconstructs canvas state", () => {
  // Each pixel write is a 4-round-trip transaction; with cloud Postgres
  // (Neon) the dozen-write fixture comfortably exceeds vitest's 5s default.
  it("byte-equal between replayed bytes and live SectorChunk rows", { timeout: 30_000 }, async () => {
    const sectorId = `replay-${randomUUID().slice(0, 8)}`;
    const ownerId = `owner-${randomUUID().slice(0, 8)}`;
    const botId = `bot-${randomUUID().slice(0, 8)}`;
    const apiKeyId = `key-${randomUUID().slice(0, 8)}`;

    // Pepper for the bot key. Test-only — the row's `keyHash` doesn't get
    // exercised, but `mintKey` enforces a >=32-byte pepper.
    const pepper = "0".repeat(64);

    // Pixel writes spread across two chunks at (0,0) and (1,0). 12 events,
    // including two same-pixel overwrites (last-write-wins must hold).
    const writes: Array<{ x: number; y: number; color: number }> = [
      { x: 5, y: 5, color: 1 },
      { x: 7, y: 9, color: 2 },
      { x: 99, y: 0, color: 3 },
      { x: 100, y: 0, color: 4 },
      { x: 150, y: 50, color: 5 },
      { x: 5, y: 5, color: 6 }, // overwrite (same chunk)
      { x: 0, y: 99, color: 7 },
      { x: 50, y: 50, color: 1 },
      { x: 100, y: 0, color: 2 }, // overwrite (different chunk than first overwrite)
      { x: 199, y: 99, color: 3 },
      { x: 75, y: 25, color: 4 },
      { x: 175, y: 75, color: 5 },
    ];

    try {
      // Seed: a sector wide enough for chunks (0,0) and (1,0). Two chunks
      // across, one tall. Owner + bot + key for FK validity on PixelEvent.
      await prisma.sector.create({
        data: {
          id: sectorId,
          name: `replay-${sectorId}`,
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
      const handle = `replay-${randomUUID().slice(0, 8)}`;
      await prisma.bot.create({
        data: { id: botId, ownerId, handle, displayName: handle },
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

      for (const w of writes) {
        await writePixel({
          requestId: randomUUID(),
          sectorId,
          x: w.x,
          y: w.y,
          color: w.color,
          paletteVersion: 1,
          botId,
          apiKeyId,
        });
      }

      // Replay: rebuild chunks in memory by walking events in deterministic
      // (sectorId, id) ASC order — same order the M4 dashboard would replay.
      const events = await prisma.pixelEvent.findMany({
        where: { sectorId },
        select: { x: true, y: true, color: true },
        orderBy: { id: "asc" },
      });
      expect(events.length).toBe(writes.length);

      const replayed = new Map<string, Uint8Array>();
      for (const ev of events) {
        const { chunkX, chunkY, byteOffset } = chunkAddressFor({
          x: ev.x,
          y: ev.y,
        });
        const k = `${chunkX},${chunkY}`;
        let buf = replayed.get(k);
        if (!buf) {
          buf = new Uint8Array(CHUNK_BYTES);
          replayed.set(k, buf);
        }
        buf[byteOffset] = ev.color;
      }

      const liveChunks = await prisma.sectorChunk.findMany({
        where: { sectorId },
        select: { chunkX: true, chunkY: true, data: true },
      });

      // Same set of chunk coordinates.
      const liveKeys = new Set(
        liveChunks.map((c) => `${c.chunkX},${c.chunkY}`),
      );
      expect(liveKeys).toEqual(new Set(replayed.keys()));

      // Byte-equal per chunk.
      for (const c of liveChunks) {
        const k = `${c.chunkX},${c.chunkY}`;
        const replayedBytes = replayed.get(k);
        expect(replayedBytes).toBeDefined();
        expect(replayedBytes!.length).toBe(CHUNK_BYTES);
        expect(c.data.length).toBe(CHUNK_BYTES);
        // Compare as Buffers for a clear failure message (vitest pretty-prints).
        expect(Buffer.from(c.data).equals(Buffer.from(replayedBytes!))).toBe(
          true,
        );
      }

      // Spot-check: the two overwritten pixels reflect the last write.
      const lastForFiveFive = writes
        .filter((w) => w.x === 5 && w.y === 5)
        .at(-1)!.color;
      const chunk00 = liveChunks.find((c) => c.chunkX === 0 && c.chunkY === 0)!;
      const offset55 = chunkAddressFor({ x: 5, y: 5 }).byteOffset;
      expect(chunk00.data[offset55]).toBe(lastForFiveFive);
    } finally {
      await prisma.pixelEvent.deleteMany({ where: { sectorId } });
      await prisma.sectorChunk.deleteMany({ where: { sectorId } });
      await prisma.botApiKey.deleteMany({ where: { id: apiKeyId } });
      await prisma.bot.deleteMany({ where: { id: botId } });
      await prisma.owner.deleteMany({ where: { id: ownerId } });
      await prisma.sector.deleteMany({ where: { id: sectorId } });
    }
  });
});

// Linter assist: assert constants we depend on. If CHUNK_SIZE moves, the
// hard-coded chunk-(1,0) coordinates above would silently drift to a
// different chunk and the test would still pass for the wrong reason.
describe("replay test invariants", () => {
  it("CHUNK_SIZE is 100 (test fixtures assume this)", () => {
    expect(CHUNK_SIZE).toBe(100);
  });
});

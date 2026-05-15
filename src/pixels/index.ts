// Pixel-write business logic. Lives in src/<domain>/ per the agent-native
// principle — route handlers in app/api/v1/pixels/... are thin glue.

import { Buffer } from "node:buffer";

import { prisma } from "@/lib/prisma";

export const CHUNK_SIZE = 100;
export const CHUNK_BYTES = CHUNK_SIZE * CHUNK_SIZE;

const ZERO_CHUNK = Buffer.alloc(CHUNK_BYTES, 0);

export interface PixelCoordinates {
  x: number;
  y: number;
}

export interface ChunkAddress {
  chunkX: number;
  chunkY: number;
  byteOffset: number;
}

/**
 * Compute chunk addressing for an absolute pixel coordinate. Pure math —
 * the only assumption is `CHUNK_SIZE`, which is a single named constant.
 * Resizing chunks later requires a backfill migration; the M1 doc tracks
 * that as schema-lock-in risk.
 */
export function chunkAddressFor({ x, y }: PixelCoordinates): ChunkAddress {
  const chunkX = Math.floor(x / CHUNK_SIZE);
  const chunkY = Math.floor(y / CHUNK_SIZE);
  const inChunkX = x - chunkX * CHUNK_SIZE;
  const inChunkY = y - chunkY * CHUNK_SIZE;
  return {
    chunkX,
    chunkY,
    byteOffset: inChunkY * CHUNK_SIZE + inChunkX,
  };
}

export interface WritePixelInput {
  requestId: string;
  sectorId: string;
  x: number;
  y: number;
  color: number;
  paletteVersion: number;
  botId: string;
  apiKeyId: string;
  /**
   * Optional bot-supplied comment for this specific write. Caller is
   * responsible for moderation — `src/pixels/comment.ts:validateComment`
   * produces the post-moderation form expected here. Passing the raw
   * input would bypass URL-redaction and the deny-list `[redacted]`
   * policy.
   */
  comment?: string | null;
}

export interface WritePixelResult {
  chunkVersion: bigint;
  acceptedAt: Date;
  /** Echoes the stored comment (post-moderation). `null` if none. */
  comment: string | null;
}

/**
 * Write a single pixel. Atomic: lazy-create the chunk, lock it via SELECT
 * FOR UPDATE, mutate the byte at the right offset, increment the version,
 * and append a PixelEvent — all in one Prisma transaction.
 *
 * Last-write-wins semantics with `(sectorId, id) ASC` as the deterministic
 * replay tiebreaker. The caller is responsible for bounds + color
 * validation; this function trusts its inputs.
 */
export async function writePixel(
  input: WritePixelInput,
): Promise<WritePixelResult> {
  const { chunkX, chunkY, byteOffset } = chunkAddressFor({
    x: input.x,
    y: input.y,
  });

  return prisma.$transaction(async (tx) => {
    // Lazy-create the chunk row if it doesn't exist yet. Empty `update`
    // makes this an "ensure" — no-op if the row is already there.
    await tx.sectorChunk.upsert({
      where: {
        sectorId_chunkX_chunkY: {
          sectorId: input.sectorId,
          chunkX,
          chunkY,
        },
      },
      create: {
        sectorId: input.sectorId,
        chunkX,
        chunkY,
        data: ZERO_CHUNK,
        version: 0n,
      },
      update: {},
    });

    // Lock + read. Prisma doesn't expose FOR UPDATE on findUnique; raw SQL
    // is the documented escape hatch. We're inside the upsert's tx so the
    // row is guaranteed to exist.
    const rows = await tx.$queryRaw<
      Array<{ data: Uint8Array; version: bigint }>
    >`
      SELECT data, version FROM sector_chunks
      WHERE sector_id = ${input.sectorId}
        AND chunk_x = ${chunkX}
        AND chunk_y = ${chunkY}
      FOR UPDATE
    `;
    const current = rows[0];
    if (!current) {
      // Should be impossible given the upsert above; surface as a real error.
      throw new Error(
        `chunk row missing after upsert: ${input.sectorId} (${chunkX},${chunkY})`,
      );
    }

    // Modify in memory.
    const newData = Buffer.from(current.data);
    newData[byteOffset] = input.color;
    const newVersion = current.version + 1n;

    // Write back.
    await tx.sectorChunk.update({
      where: {
        sectorId_chunkX_chunkY: {
          sectorId: input.sectorId,
          chunkX,
          chunkY,
        },
      },
      data: { data: newData, version: newVersion },
    });

    // Append to event log. createdAt is the canonical "accepted_at".
    const storedComment = input.comment ?? null;
    const event = await tx.pixelEvent.create({
      data: {
        requestId: input.requestId,
        sectorId: input.sectorId,
        x: input.x,
        y: input.y,
        color: input.color,
        paletteVersion: input.paletteVersion,
        botId: input.botId,
        apiKeyId: input.apiKeyId,
        chunkVersionAfter: newVersion,
        comment: storedComment,
      },
      select: { createdAt: true },
    });

    return {
      chunkVersion: newVersion,
      acceptedAt: event.createdAt,
      comment: storedComment,
    };
  });
}

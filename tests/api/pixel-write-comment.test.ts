// POST /api/v1/pixels — `comment` field end-to-end.
//
// Exercises: happy path with a clean comment, comment omitted, URL
// silent-redaction, deny-list whole-comment swap to `[redacted]`,
// length-cap rejection, and the read-back surfaces (single-pixel
// attribution + per-bot events both carry the stored form).
//
// DB-gated like the other route tests; runs in CI under the Postgres
// service container.

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { POST as postPixel } from "@/app/api/v1/pixels/route";
import { GET as getBotEvents } from "@/app/api/v1/public/bots/[handle]/events/route";
import { GET as getPixel } from "@/app/api/v1/public/sectors/[id]/pixels/[x]/[y]/route";
import { MAX_COMMENT_LENGTH } from "@/lib/limits";
import { prisma } from "@/lib/prisma";
import { mintKey } from "@/src/auth/api-keys";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

interface Seed {
  sectorId: string;
  ownerId: string;
  botId: string;
  botHandle: string;
  apiKeyPlaintext: string;
}

async function seed(): Promise<Seed> {
  const sectorId = `pixcom-${randomUUID().slice(0, 8)}`;
  const ownerId = `owner-${randomUUID().slice(0, 8)}`;
  const botId = `bot-${randomUUID().slice(0, 8)}`;
  const handle = `pixcomtest-${randomUUID().slice(0, 6).toLowerCase()}`;
  const pepper = process.env.BOTPLACE_API_KEY_PEPPER ?? "0".repeat(64);
  await prisma.sector.create({
    data: {
      id: sectorId,
      name: sectorId,
      width: 200,
      height: 200,
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
  // POWER tier so the suite can burst — FREE's per-key bucket is
  // 1 token / 60s and would 429 on the second test in this file.
  await prisma.bot.create({
    data: {
      id: botId,
      ownerId,
      handle,
      displayName: handle,
      rateTier: "POWER",
    },
  });
  const minted = mintKey("bp_live", pepper);
  await prisma.botApiKey.create({
    data: { botId, keyHash: minted.hash, prefix: minted.prefix },
  });
  return {
    sectorId,
    ownerId,
    botId,
    botHandle: handle,
    apiKeyPlaintext: minted.plaintext,
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

// Each request gets a unique synthetic IP so tests don't share the
// FREE-tier per-IP write bucket. POWER tier seeded above also skips
// the IP bucket — belt + suspenders.
function uniqueIp(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.${r()}.${r()}.${r()}`;
}

function pixelRequest(s: Seed, body: unknown) {
  return new Request("http://test/api/v1/pixels", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": uniqueIp(),
      authorization: `Bearer ${s.apiKeyPlaintext}`,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describeIfDb("POST /api/v1/pixels — comment field", () => {
  it(
    "happy path: writes pixel + persists clean comment + echoes in response",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 5,
            y: 5,
            color: 3,
            comment: "dropping a glider here",
          }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.comment).toBe("dropping a glider here");
        // The chunk_version + accepted_at fields stayed intact.
        expect(body.chunk_version).toBe("1");
        expect(body.accepted_at).toMatch(/^20\d\d-/);

        // Persisted on the row.
        const event = await prisma.pixelEvent.findFirst({
          where: { sectorId: s.sectorId },
          select: { comment: true },
        });
        expect(event?.comment).toBe("dropping a glider here");
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "omitted comment: stores null + response echoes null",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 1,
            y: 1,
            color: 2,
          }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.comment).toBeNull();
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "URL silent-redact: replaces URLs with [link], surrounding text survives",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 2,
            y: 2,
            color: 4,
            comment: "see my repo at https://example.com — cool stuff",
          }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.comment).toBe("see my repo at [link] — cool stuff");
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "deny-list match: replaces WHOLE comment with [redacted] (pixel still lands)",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 3,
            y: 3,
            color: 5,
            comment: "a porn-themed glider",
          }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        // The whole comment is gone; just the literal sentinel.
        expect(body.comment).toBe("[redacted]");
        // Crucially: the pixel still landed. chunk_version advanced.
        expect(body.chunk_version).toBe("1");
        // The matched term is never echoed in any field.
        for (const v of Object.values(body)) {
          if (typeof v === "string") {
            expect(v.toLowerCase()).not.toContain("porn");
          }
        }
        // Persisted row carries the literal sentinel — not the
        // original comment, not null.
        const event = await prisma.pixelEvent.findFirst({
          where: { sectorId: s.sectorId },
          select: { comment: true },
        });
        expect(event?.comment).toBe("[redacted]");
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "length cap: rejects whole write with 400 comment_too_long",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const tooLong = "x".repeat(MAX_COMMENT_LENGTH + 1);
        const res = await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 4,
            y: 4,
            color: 1,
            comment: tooLong,
          }),
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body).toMatchObject({
          error: "invalid_input",
          field: "comment",
          reason: "comment_too_long",
        });
        // No pixel landed.
        const count = await prisma.pixelEvent.count({
          where: { sectorId: s.sectorId },
        });
        expect(count).toBe(0);
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "non-string non-null comment: 400 comment_invalid",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 6,
            y: 6,
            color: 1,
            comment: 42,
          }),
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.reason).toBe("comment_invalid");
      } finally {
        await cleanup(s);
      }
    },
  );
});

describeIfDb("comment surfaces on read endpoints", () => {
  it(
    "single-pixel attribution returns the comment from the most recent write",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        // Two writes to the same pixel, different comments. Most-
        // recent wins on the attribution endpoint.
        await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 10,
            y: 10,
            color: 1,
            comment: "first write",
          }),
        );
        await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 10,
            y: 10,
            color: 2,
            comment: "second write",
          }),
        );

        const res = await getPixel(new Request("http://test/"), {
          params: Promise.resolve({
            id: s.sectorId,
            x: "10",
            y: "10",
          }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.comment).toBe("second write");
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "unwritten pixel attribution returns comment: null",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await getPixel(new Request("http://test/"), {
          params: Promise.resolve({
            id: s.sectorId,
            x: "99",
            y: "99",
          }),
        });
        const body = await res.json();
        expect(body.comment).toBeNull();
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "per-bot events carries comment on every row",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 20,
            y: 20,
            color: 1,
            comment: "alpha",
          }),
        );
        await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 21,
            y: 21,
            color: 2,
            // No comment on this one.
          }),
        );

        const res = await getBotEvents(new Request("http://test/"), {
          params: Promise.resolve({ handle: s.botHandle }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body).toHaveLength(2);
        // Sorted desc by accepted_at, so newest (no-comment) first.
        const sorted = [...body].sort(
          (a, b) => a.x - b.x,
        ) as Array<{ x: number; comment: string | null }>;
        expect(sorted[0].comment).toBe("alpha");
        expect(sorted[1].comment).toBeNull();
      } finally {
        await cleanup(s);
      }
    },
  );
});

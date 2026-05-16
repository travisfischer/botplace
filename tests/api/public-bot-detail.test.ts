// GET /api/v1/public/bots/:handle_or_id — public bot-detail endpoint.
//
// Dual-lookup: handle OR cuid id. Skip when DATABASE_URL is unset.

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { GET as getBotDetail } from "@/app/api/v1/public/bots/[handle_or_id]/route";
import { prisma } from "@/lib/prisma";
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

async function seed(opts: { description?: string | null } = {}): Promise<Seed> {
  const sectorId = `botdetail-${randomUUID().slice(0, 8)}`;
  const ownerId = `owner-${randomUUID().slice(0, 8)}`;
  const handle = `botdetail-${randomUUID().slice(0, 6).toLowerCase()}`;
  const displayName = `Detail Test ${handle}`;
  const apiKeyId = `key-${randomUUID().slice(0, 8)}`;
  await prisma.sector.create({
    data: {
      id: sectorId,
      name: sectorId,
      width: 100,
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
  const bot = await prisma.bot.create({
    data: {
      ownerId,
      handle,
      displayName,
      description: opts.description ?? null,
      descriptionUpdatedAt: opts.description ? new Date() : null,
    },
  });
  await prisma.botApiKey.create({
    data: { id: apiKeyId, botId: bot.id, keyHash: `hash-${apiKeyId}`, prefix: "bp_live_xxx" },
  });
  return {
    sectorId,
    ownerId,
    botId: bot.id,
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

function detailRequest(): Request {
  return new Request("http://test/");
}

describeIfDb("GET /api/v1/public/bots/:handle_or_id", () => {
  it(
    "resolves by handle",
    { timeout: 30_000 },
    async () => {
      const s = await seed({ description: "I draw gliders." });
      try {
        const res = await getBotDetail(detailRequest(), {
          params: Promise.resolve({ handle_or_id: s.botHandle }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
          id: s.botId,
          handle: s.botHandle,
          display_name: s.botDisplayName,
          description: "I draw gliders.",
          rate_tier: "FREE",
        });
        expect(body.owner_id).toBeUndefined();
        expect(body.api_keys).toBeUndefined();
        expect(body.last_seen_at).toBeNull();
        expect(body.created_at).toMatch(/^20\d\d-/);
        expect(body.description_updated_at).toMatch(/^20\d\d-/);
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "resolves by cuid id",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await getBotDetail(detailRequest(), {
          params: Promise.resolve({ handle_or_id: s.botId }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
          handle: s.botHandle,
          description: null,
          description_updated_at: null,
        });
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "returns last_seen_at from the most recent PixelEvent across sectors",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        await writePixel({
          requestId: randomUUID(),
          sectorId: s.sectorId,
          x: 5,
          y: 5,
          color: 1,
          paletteVersion: 1,
          botId: s.botId,
          apiKeyId: s.apiKeyId,
        });
        const res = await getBotDetail(detailRequest(), {
          params: Promise.resolve({ handle_or_id: s.botHandle }),
        });
        const body = await res.json();
        expect(body.last_seen_at).toMatch(/^20\d\d-/);
      } finally {
        await cleanup(s);
      }
    },
  );

  it("404s on unknown handle", async () => {
    const res = await getBotDetail(detailRequest(), {
      params: Promise.resolve({ handle_or_id: "doesnotexist-abc" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("bot_not_found");
  });

  it("404s on unknown cuid", async () => {
    const res = await getBotDetail(detailRequest(), {
      params: Promise.resolve({ handle_or_id: "c" + "x".repeat(24) }),
    });
    expect(res.status).toBe(404);
  });

  it("400s on syntactically invalid input", async () => {
    // Handle regex requires lowercase + hyphens only; uppercase fails.
    const res = await getBotDetail(detailRequest(), {
      params: Promise.resolve({ handle_or_id: "NotAValidHandle" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe("handle_or_id_invalid");
  });

  it("emits cache headers on success", async () => {
    const s = await seed();
    try {
      const res = await getBotDetail(detailRequest(), {
        params: Promise.resolve({ handle_or_id: s.botHandle }),
      });
      expect(res.headers.get("Cache-Control")).toMatch(/s-maxage=/);
      expect(res.headers.get("CDN-Cache-Control")).toMatch(/s-maxage=/);
      expect(res.headers.get("X-Request-Id")).toBeTruthy();
    } finally {
      await cleanup(s);
    }
  });
});

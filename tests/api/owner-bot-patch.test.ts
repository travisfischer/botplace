// PATCH /api/v1/bots/:id — owner-side description writes.
//
// Owner-scoped sibling of PATCH /api/v1/bots/me. PAT/session auth; the
// bot must belong to the caller's owner — cross-owner requests get
// `bot_not_found` (404), never leak that the id exists elsewhere.

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Stub the Auth.js entrypoint so vitest doesn't transitively load
// next-auth's ESM (which has a broken `next/server` re-export in this
// version). The owner-auth resolver in src/auth/authenticate.ts calls
// `auth()` first to check for a session cookie — returning null forces
// the PAT-bearer fallback, which is what these tests exercise.
vi.mock("@/auth", () => ({ auth: async () => null }));

import { PATCH as patchBot } from "@/app/api/v1/bots/[id]/route";
import { mintKey } from "@/src/auth/api-keys";
import { prisma } from "@/lib/prisma";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

interface Seed {
  ownerId: string;
  botId: string;
  patPlaintext: string;
}

async function seed(): Promise<Seed> {
  const ownerId = `owner-${randomUUID().slice(0, 8)}`;
  const handle = `ownerpatch-${randomUUID().slice(0, 6).toLowerCase()}`;
  const pepper = process.env.BOTPLACE_API_KEY_PEPPER ?? "0".repeat(64);
  await prisma.owner.create({
    data: {
      id: ownerId,
      googleSub: `test-${ownerId}`,
      email: `${ownerId}@example.test`,
      displayName: ownerId,
    },
  });
  const bot = await prisma.bot.create({
    data: { ownerId, handle, displayName: handle },
  });
  // Mint the PAT directly via the low-level key helper so this test
  // file does NOT transitively import next-auth (which doesn't load
  // cleanly under vitest's resolver).
  const minted = mintKey("bp_pat", pepper);
  await prisma.ownerPersonalAccessToken.create({
    data: {
      ownerId,
      tokenHash: minted.hash,
      prefix: minted.prefix,
      name: `test-${ownerId}`,
    },
  });
  return { ownerId, botId: bot.id, patPlaintext: minted.plaintext };
}

async function cleanup(s: Seed): Promise<void> {
  await prisma.ownerPersonalAccessToken.deleteMany({ where: { ownerId: s.ownerId } });
  await prisma.bot.deleteMany({ where: { id: s.botId } });
  await prisma.owner.deleteMany({ where: { id: s.ownerId } });
}

function patchRequest(
  botId: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`http://test/api/v1/bots/${botId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describeIfDb("PATCH /api/v1/bots/:id (owner-scoped)", () => {
  it("401 when unauthenticated", async () => {
    const res = await patchBot(patchRequest("any-id", { description: "x" }), {
      params: Promise.resolve({ id: "any-id" }),
    });
    expect(res.status).toBe(401);
  });

  it("401 when a bot key is used (this endpoint is PAT/session only)", async () => {
    const res = await patchBot(
      patchRequest(
        "any-id",
        { description: "x" },
        { authorization: "Bearer bp_live_anything" },
      ),
      { params: Promise.resolve({ id: "any-id" }) },
    );
    expect(res.status).toBe(401);
  });

  it(
    "sets a description on an owned bot",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await patchBot(
          patchRequest(
            s.botId,
            { description: "I draw gliders." },
            { authorization: `Bearer ${s.patPlaintext}` },
          ),
          { params: Promise.resolve({ id: s.botId }) },
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.bot.description).toBe("I draw gliders.");
        const row = await prisma.bot.findUnique({
          where: { id: s.botId },
          select: { description: true },
        });
        expect(row?.description).toBe("I draw gliders.");
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "rejects cross-owner update with 404 bot_not_found",
    { timeout: 30_000 },
    async () => {
      // Two owners; owner A's PAT cannot update owner B's bot.
      const a = await seed();
      const b = await seed();
      try {
        const res = await patchBot(
          patchRequest(
            b.botId,
            { description: "owned by B; A trying to write" },
            { authorization: `Bearer ${a.patPlaintext}` },
          ),
          { params: Promise.resolve({ id: b.botId }) },
        );
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe("bot_not_found");
        // Confirm B's row is untouched.
        const row = await prisma.bot.findUnique({
          where: { id: b.botId },
          select: { description: true },
        });
        expect(row?.description).toBeNull();
      } finally {
        await cleanup(a);
        await cleanup(b);
      }
    },
  );

  it(
    "rejects unknown fields with unknown_field",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await patchBot(
          patchRequest(
            s.botId,
            { display_name: "renamed" },
            { authorization: `Bearer ${s.patPlaintext}` },
          ),
          { params: Promise.resolve({ id: s.botId }) },
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.reason).toBe("unknown_field");
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "rejects deny-listed content without echoing the term",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await patchBot(
          patchRequest(
            s.botId,
            { description: "a porn bot" },
            { authorization: `Bearer ${s.patPlaintext}` },
          ),
          { params: Promise.resolve({ id: s.botId }) },
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.reason).toBe("description_blocked");
        for (const v of Object.values(body)) {
          if (typeof v === "string") {
            expect(v.toLowerCase()).not.toContain("porn");
          }
        }
      } finally {
        await cleanup(s);
      }
    },
  );
});

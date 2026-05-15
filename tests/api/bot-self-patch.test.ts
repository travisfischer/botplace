// PATCH /api/v1/bots/me — bot-self description writes.
//
// Skip when DATABASE_URL is unset (same gate as other route tests). The
// rate-limit module falls back to in-process memory buckets without
// Upstash env, so we don't need a Redis instance.

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { PATCH as patchMe } from "@/app/api/v1/bots/me/route";
import { prisma } from "@/lib/prisma";
import { mintKey } from "@/src/auth/api-keys";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

interface Seed {
  ownerId: string;
  botId: string;
  apiKeyPlaintext: string;
}

async function seed(): Promise<Seed> {
  const ownerId = `owner-${randomUUID().slice(0, 8)}`;
  const botId = `bot-${randomUUID().slice(0, 8)}`;
  const handle = `botselftest-${randomUUID().slice(0, 6).toLowerCase()}`;
  const pepper = process.env.BOTPLACE_API_KEY_PEPPER ?? "0".repeat(64);
  await prisma.owner.create({
    data: {
      id: ownerId,
      googleSub: `test-${ownerId}`,
      email: `${ownerId}@example.test`,
      displayName: ownerId,
    },
  });
  // POWER tier so the suite can do bursts (the "clears" test makes TWO
  // sequential PATCH /me calls on the same bot key; FREE's per-key
  // bucket is 1 token / 60s and would 429 on the second call).
  // Bot-self auth path treats the tier the same shape either way; the
  // rate-limit bucket is the only difference.
  await prisma.bot.create({
    data: { id: botId, ownerId, handle, displayName: handle, rateTier: "POWER" },
  });
  const minted = mintKey("bp_live", pepper);
  await prisma.botApiKey.create({
    data: { botId, keyHash: minted.hash, prefix: minted.prefix },
  });
  return { ownerId, botId, apiKeyPlaintext: minted.plaintext };
}

async function cleanup(s: Seed): Promise<void> {
  await prisma.botApiKey.deleteMany({ where: { botId: s.botId } });
  await prisma.bot.deleteMany({ where: { id: s.botId } });
  await prisma.owner.deleteMany({ where: { id: s.ownerId } });
}

// Each request gets a unique synthetic source IP so tests don't share
// the FREE-tier per-IP write bucket (capacity 1, 1 token / 60s). The
// per-bot bucket is already unique-per-test because each `seed()`
// mints a fresh API key; without this, the FIRST test passes and
// every subsequent one returns 429 on the shared `unknown` IP.
function uniqueIp(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.${r()}.${r()}.${r()}`;
}

function patchRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://test/api/v1/bots/me", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": uniqueIp(),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describeIfDb("PATCH /api/v1/bots/me", () => {
  describe("auth", () => {
    it("401 missing_header when no Authorization", async () => {
      const res = await patchMe(patchRequest({ description: "hi" }));
      expect(res.status).toBe(401);
    });

    it("401 wrong_credential_type when PAT used", async () => {
      const res = await patchMe(
        patchRequest(
          { description: "hi" },
          { authorization: "Bearer bp_pat_anything" },
        ),
      );
      expect(res.status).toBe(401);
    });

    it("401 unknown_key when bot key isn't recognized", async () => {
      const res = await patchMe(
        patchRequest(
          { description: "hi" },
          { authorization: "Bearer bp_live_bogus" },
        ),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("happy path", () => {
    it(
      "sets a description and echoes the post-write state",
      { timeout: 30_000 },
      async () => {
        const s = await seed();
        try {
          const res = await patchMe(
            patchRequest(
              { description: "  I draw gliders.  " },
              { authorization: `Bearer ${s.apiKeyPlaintext}` },
            ),
          );
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.bot).toMatchObject({
            description: "I draw gliders.",
          });
          expect(body.bot.description_updated_at).toMatch(/^20\d\d-/);
          // Persisted form: trimmed
          const row = await prisma.bot.findUnique({
            where: { id: s.botId },
            select: { description: true, descriptionUpdatedAt: true },
          });
          expect(row?.description).toBe("I draw gliders.");
          expect(row?.descriptionUpdatedAt).toBeTruthy();
        } finally {
          await cleanup(s);
        }
      },
    );

    it(
      "clears description when value is null",
      { timeout: 30_000 },
      async () => {
        const s = await seed();
        try {
          // Set, then clear.
          await patchMe(
            patchRequest(
              { description: "first" },
              { authorization: `Bearer ${s.apiKeyPlaintext}` },
            ),
          );
          const res = await patchMe(
            patchRequest(
              { description: null },
              { authorization: `Bearer ${s.apiKeyPlaintext}` },
            ),
          );
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.bot.description).toBeNull();
          const row = await prisma.bot.findUnique({
            where: { id: s.botId },
            select: { description: true },
          });
          expect(row?.description).toBeNull();
        } finally {
          await cleanup(s);
        }
      },
    );

    it(
      "redacts URLs silently and reports the redaction count via stored form",
      { timeout: 30_000 },
      async () => {
        const s = await seed();
        try {
          const res = await patchMe(
            patchRequest(
              { description: "find me at https://example.com" },
              { authorization: `Bearer ${s.apiKeyPlaintext}` },
            ),
          );
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.bot.description).toBe("find me at [link]");
          // Stored form is what we got back
          const row = await prisma.bot.findUnique({
            where: { id: s.botId },
            select: { description: true },
          });
          expect(row?.description).toBe("find me at [link]");
        } finally {
          await cleanup(s);
        }
      },
    );

    it(
      "treats whitespace-only as a clear",
      { timeout: 30_000 },
      async () => {
        const s = await seed();
        try {
          const res = await patchMe(
            patchRequest(
              { description: "    " },
              { authorization: `Bearer ${s.apiKeyPlaintext}` },
            ),
          );
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.bot.description).toBeNull();
        } finally {
          await cleanup(s);
        }
      },
    );
  });

  describe("rejections", () => {
    it(
      "rejects non-string non-null description with 400 description_invalid",
      { timeout: 30_000 },
      async () => {
        const s = await seed();
        try {
          const res = await patchMe(
            patchRequest(
              { description: 42 },
              { authorization: `Bearer ${s.apiKeyPlaintext}` },
            ),
          );
          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body).toMatchObject({
            error: "invalid_input",
            field: "description",
            reason: "description_invalid",
          });
        } finally {
          await cleanup(s);
        }
      },
    );

    it(
      "rejects over-length description (501 chars) with description_too_long",
      { timeout: 30_000 },
      async () => {
        const s = await seed();
        try {
          const tooLong = "a".repeat(501);
          const res = await patchMe(
            patchRequest(
              { description: tooLong },
              { authorization: `Bearer ${s.apiKeyPlaintext}` },
            ),
          );
          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.reason).toBe("description_too_long");
        } finally {
          await cleanup(s);
        }
      },
    );

    it(
      "rejects deny-listed content with description_blocked (no term echoed)",
      { timeout: 30_000 },
      async () => {
        const s = await seed();
        try {
          const res = await patchMe(
            patchRequest(
              { description: "this is a porn bot" },
              { authorization: `Bearer ${s.apiKeyPlaintext}` },
            ),
          );
          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.reason).toBe("description_blocked");
          // No echo of the matched term in any response field.
          for (const v of Object.values(body)) {
            if (typeof v === "string") {
              expect(v.toLowerCase()).not.toContain("porn");
            }
          }
          // Row unchanged (description still null).
          const row = await prisma.bot.findUnique({
            where: { id: s.botId },
            select: { description: true },
          });
          expect(row?.description).toBeNull();
        } finally {
          await cleanup(s);
        }
      },
    );

    it(
      "rejects unknown fields with 400 unknown_field",
      { timeout: 30_000 },
      async () => {
        const s = await seed();
        try {
          const res = await patchMe(
            patchRequest(
              { display_name: "renamed" },
              { authorization: `Bearer ${s.apiKeyPlaintext}` },
            ),
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
      "rejects empty body (no recognized field) with no_op",
      { timeout: 30_000 },
      async () => {
        const s = await seed();
        try {
          const res = await patchMe(
            patchRequest(
              {},
              { authorization: `Bearer ${s.apiKeyPlaintext}` },
            ),
          );
          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.reason).toBe("no_op");
        } finally {
          await cleanup(s);
        }
      },
    );

    it(
      "rejects malformed JSON with invalid_input",
      { timeout: 30_000 },
      async () => {
        const s = await seed();
        try {
          const res = await patchMe(
            patchRequest(
              "not json",
              { authorization: `Bearer ${s.apiKeyPlaintext}` },
            ),
          );
          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.error).toBe("invalid_input");
        } finally {
          await cleanup(s);
        }
      },
    );
  });
});

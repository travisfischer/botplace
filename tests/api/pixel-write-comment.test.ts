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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    "non-string non-null comment: 400 comment_required",
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
        expect(body.reason).toBe("comment_required");
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

// ---------------------------------------------------------------------------
// Audit-log shape (P1.1 from the multi-reviewer review)
// ---------------------------------------------------------------------------
// `app/api/v1/pixels/route.ts` emits structured JSON log lines via
// `lib/log.ts`. The new comment-moderation fields (`field`, `length`,
// `redactions_count`, `comment_term_redacted`, `denylist_version`,
// `denylist_term_hash`) are load-bearing for operator forensics —
// they're the moderation incident's ONLY signal under the
// redact-and-accept policy. A silent refactor that drops or renames
// them would be an information regression. This block pins the shape
// at the route layer (a similar invariant test for the moderation
// primitives lives in tests/moderation/moderation.test.ts).
//
// Implementation: spy on console.log/warn (where lib/log.ts emits) and
// filter by `path` so we capture only pixel-write log lines, not
// Prisma query logs or framework noise.

interface CapturedLog {
  level: "info" | "warn" | "error";
  fields: Record<string, unknown>;
}

function captureLogs() {
  const captured: CapturedLog[] = [];
  const spy = (level: "info" | "warn" | "error", method: "log" | "warn" | "error") =>
    vi.spyOn(console, method).mockImplementation((line: unknown) => {
      if (typeof line !== "string") return;
      try {
        const fields = JSON.parse(line) as Record<string, unknown>;
        captured.push({ level, fields });
      } catch {
        // not a structured-log line — ignore
      }
    });
  const spies = [
    spy("info", "log"),
    spy("warn", "warn"),
    spy("error", "error"),
  ];
  return {
    captured,
    pixelLines: () =>
      captured.filter((c) => c.fields.path === "/api/v1/pixels"),
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

describeIfDb("POST /api/v1/pixels — audit-log shape (P1.1)", () => {
  let cap: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    cap = captureLogs();
  });
  afterEach(() => {
    cap.restore();
  });

  it(
    "clean comment: success line carries field/length/redactions_count/denylist_version, no term hash",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const input = "I draw gliders here";
        const res = await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 30,
            y: 30,
            color: 3,
            comment: input,
          }),
        );
        expect(res.status).toBe(200);

        const line = cap.pixelLines().find((l) => l.level === "info");
        expect(line, "expected one info log line for the pixel write").toBeDefined();
        expect(line!.fields).toMatchObject({
          status: 200,
          field: "comment",
          length: input.length,
          redactions_count: 0,
          comment_term_redacted: false,
          denylist_version: expect.stringMatching(/^v\d+-\d{4}-\d{2}-\d{2}$/),
        });
        expect(line!.fields.denylist_term_hash).toBeUndefined();
        // Crucial: the raw comment body is NOT in the log.
        const serialized = JSON.stringify(line!.fields);
        expect(serialized).not.toContain(input);
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "deny-list hit: success line carries comment_term_redacted=true + 16-hex denylist_term_hash; no plaintext term",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 31,
            y: 31,
            color: 4,
            comment: "a porn comment",
          }),
        );
        expect(res.status).toBe(200);

        const line = cap.pixelLines().find((l) => l.level === "info");
        expect(line, "expected one info log line").toBeDefined();
        expect(line!.fields.comment_term_redacted).toBe(true);
        expect(line!.fields.denylist_term_hash).toMatch(/^[0-9a-f]{16}$/);
        expect(line!.fields.denylist_version).toMatch(/^v\d+-\d{4}-\d{2}-\d{2}$/);
        // Crucial: no plaintext deny-listed term anywhere in the line.
        // The matched term itself is "porn" (v1 list); the raw comment
        // includes it; both must be absent from the serialized form.
        const serialized = JSON.stringify(line!.fields).toLowerCase();
        expect(serialized).not.toContain("porn");
        // The stored form is `[redacted]` (the literal sentinel) — but
        // the log line carries `length: 10` (length of "[redacted]"),
        // not the raw comment body.
        expect(line!.fields.length).toBe("[redacted]".length);
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "length reject: warn line carries field=comment + error_slug=comment_too_long + length, no raw body",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const tooLong = "x".repeat(200);
        const res = await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 32,
            y: 32,
            color: 1,
            comment: tooLong,
          }),
        );
        expect(res.status).toBe(400);

        const line = cap.pixelLines().find(
          (l) => l.level === "warn" && l.fields.error_slug === "comment_too_long",
        );
        expect(line, "expected one warn log line for comment_too_long").toBeDefined();
        expect(line!.fields).toMatchObject({
          status: 400,
          error_slug: "comment_too_long",
          field: "comment",
          length: tooLong.length,
          denylist_version: expect.stringMatching(/^v\d+-\d{4}-\d{2}-\d{2}$/),
        });
        // Raw comment body must not appear in the log.
        const serialized = JSON.stringify(line!.fields);
        expect(serialized).not.toContain(tooLong);
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "comment_required (non-string): warn line carries field=comment + error_slug=comment_required, NO length field",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 33,
            y: 33,
            color: 1,
            comment: 42, // wrong type
          }),
        );
        expect(res.status).toBe(400);

        const line = cap.pixelLines().find(
          (l) => l.level === "warn" && l.fields.error_slug === "comment_required",
        );
        expect(line).toBeDefined();
        expect(line!.fields).toMatchObject({
          status: 400,
          error_slug: "comment_required",
          field: "comment",
          denylist_version: expect.stringMatching(/^v\d+-\d{4}-\d{2}-\d{2}$/),
        });
        // `length` is intentionally absent here — the validator's union
        // only sets it on the comment_too_long arm. P2.3 from the review
        // closed the "comment_length: undefined" bug.
        expect(line!.fields).not.toHaveProperty("length");
      } finally {
        await cleanup(s);
      }
    },
  );

  it(
    "omitted comment: info line carries no comment-moderation fields",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await postPixel(
          pixelRequest(s, {
            sector_id: s.sectorId,
            x: 34,
            y: 34,
            color: 2,
          }),
        );
        expect(res.status).toBe(200);

        const line = cap.pixelLines().find((l) => l.level === "info");
        expect(line).toBeDefined();
        // Pixel write succeeded; no comment moderation happened; the
        // comment-related fields are omitted entirely.
        expect(line!.fields).not.toHaveProperty("field");
        expect(line!.fields).not.toHaveProperty("length");
        expect(line!.fields).not.toHaveProperty("redactions_count");
        expect(line!.fields).not.toHaveProperty("comment_term_redacted");
        expect(line!.fields).not.toHaveProperty("denylist_version");
        expect(line!.fields).not.toHaveProperty("denylist_term_hash");
      } finally {
        await cleanup(s);
      }
    },
  );
});

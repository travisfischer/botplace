// Auth invariants for the M1 API.
//
// 1. Byte-identical 401 across every auth-failure branch on the pixel-write
//    endpoint. This is the contract that lets `auth_failure_reason` exist
//    only in the structured log — bot authors can't probe which branch
//    matched.
// 2. Admin endpoint returns 404 (not 401) on missing/wrong tokens. This
//    is the disclosure-protection invariant — an external prober shouldn't
//    learn that `/api/v1/admin/...` paths exist.
//
// These are HTTP-level contract tests: they import the route module and
// hand it constructed `Request` objects, asserting on the returned
// `Response` body bytes. The tests skip themselves if `DATABASE_URL` is
// unset (the bogus-key branch performs a Prisma lookup).

import { describe, expect, it } from "vitest";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const HAS_PEPPER = Boolean(process.env.BOTPLACE_API_KEY_PEPPER);
const HAS_ADMIN_TOKEN = Boolean(process.env.ADMIN_TOKEN);
const describeIfDb = HAS_DB && HAS_PEPPER ? describe : describe.skip;
const describeAdmin = HAS_DB && HAS_ADMIN_TOKEN ? describe : describe.skip;

async function bodyBytes(res: Response): Promise<string> {
  return await res.text();
}

describeIfDb("byte-identical 401 on POST /api/v1/pixels", () => {
  it("every auth-failure branch returns the exact same body bytes", async () => {
    const { POST } = await import(
      "@/app/api/v1/pixels/route"
    );

    const url = "http://localhost:3000/api/v1/pixels";
    const validBody = JSON.stringify({
      sector_id: "sector-1",
      x: 0,
      y: 0,
      color: 0,
    });

    // Branch 1: no Authorization header (missing_header).
    const r1 = await POST(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: validBody,
      }),
    );

    // Branch 2: empty / malformed Authorization header (malformed_header).
    const r2 = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "NotBearer xyz",
        },
        body: validBody,
      }),
    );

    // Branch 3: PAT prefix (wrong_credential_type — bot endpoint rejects PATs).
    const r3 = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer bp_pat_definitely-not-real-token",
        },
        body: validBody,
      }),
    );

    // Branch 4: bot-key prefix that doesn't exist in the DB (unknown_key).
    const r4 = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer bp_live_definitely-not-real-key",
        },
        body: validBody,
      }),
    );

    for (const r of [r1, r2, r3, r4]) {
      expect(r.status).toBe(401);
    }

    const bodies = await Promise.all(
      [r1, r2, r3, r4].map((r) => bodyBytes(r)),
    );
    // Byte-identical across every branch — the differentiator is the
    // structured server log, not the response body.
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toBe('{"error":"unauthorized"}');
  });
});

describeAdmin("404 disclosure protection on /api/v1/admin/revoke-key", () => {
  it("returns 404 on missing token, wrong token, and same body shape", async () => {
    const { POST } = await import(
      "@/app/api/v1/admin/revoke-key/route"
    );

    const url = "http://localhost:3000/api/v1/admin/revoke-key";
    const body = JSON.stringify({ key_id: "irrelevant" });

    const noAuth = await POST(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    );
    const badAuth = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-admin-token",
        },
        body,
      }),
    );

    // Both should 404 — the path is not advertised.
    expect(noAuth.status).toBe(404);
    expect(badAuth.status).toBe(404);

    // Bodies match — caller can't tell missing-vs-wrong from the response.
    const [b1, b2] = await Promise.all([
      bodyBytes(noAuth),
      bodyBytes(badAuth),
    ]);
    expect(b1).toBe('{"error":"not_found"}');
    expect(b2).toBe('{"error":"not_found"}');
  });
});

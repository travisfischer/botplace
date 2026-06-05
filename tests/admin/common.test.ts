// Unit tests for the pure helpers in scripts/admin/_common.mjs. No DB.

import { describe, expect, it } from "vitest";

import { PassThrough } from "node:stream";

import { dbUrlWithSsl, dbTargetLabel, confirmRetype } from "@/scripts/admin/_common.mjs";

describe("dbUrlWithSsl", () => {
  it("preserves an explicit sslmode=disable (CI / non-TLS hosts)", () => {
    const url = "postgresql://u:p@localhost:5432/db?sslmode=disable";
    expect(dbUrlWithSsl(url)).toContain("sslmode=disable");
    expect(dbUrlWithSsl(url)).not.toContain("verify-full");
  });

  it("upgrades sslmode=require to verify-full", () => {
    expect(dbUrlWithSsl("postgresql://u:p@h/db?sslmode=require")).toContain(
      "sslmode=verify-full",
    );
  });

  it("sets verify-full when sslmode is absent", () => {
    expect(dbUrlWithSsl("postgresql://u:p@h/db")).toContain("sslmode=verify-full");
  });

  it("returns a non-URL string unchanged", () => {
    expect(dbUrlWithSsl("not a url")).toBe("not a url");
  });
});

describe("dbTargetLabel", () => {
  const PROD_URL = "postgresql://u:p@ep-prod-xyz.aws.neon.tech/db";

  // Pass branch explicitly (not undefined) so these stay hermetic: the
  // function defaults branch to process.env.NEON_BRANCH_NAME, which the
  // test env loads from .env.

  it("shows the host from the URL when no branch env is set", () => {
    expect(dbTargetLabel(PROD_URL, "")).toBe(
      'host "ep-prod-xyz.aws.neon.tech"',
    );
  });

  it("shows the URL host even when a mismatched branch env is set", () => {
    // The prod-reset safety bug: in a Pattern-2 prod run the operator
    // exports a prod DATABASE_URL out-of-band, but .env's NEON_BRANCH_NAME
    // still names a dev branch. The label must name the real connection
    // target (the host), with the stale branch shown only as secondary,
    // clearly-flagged context — never as the primary target.
    const label = dbTargetLabel(PROD_URL, "dev-4f6874ed");
    expect(label).toContain('host "ep-prod-xyz.aws.neon.tech"');
    expect(label).toContain("NEON_BRANCH_NAME=dev-4f6874ed");
    // host is authoritative: the branch must not masquerade as the target
    expect(label).not.toMatch(/^branch /);
  });

  it("falls back gracefully for a malformed URL", () => {
    expect(dbTargetLabel("not a url", "")).toBe("(unknown target)");
  });

  it("does not let a branch env masquerade as the target on a malformed URL", () => {
    const label = dbTargetLabel("not a url", "dev-4f6874ed");
    expect(label).not.toContain('branch "dev-4f6874ed"');
    expect(label).toContain("unknown");
  });
});

describe("confirmRetype", () => {
  function run(typed: string, expected: string): Promise<boolean> {
    const input = new PassThrough();
    const output = new PassThrough();
    const p = confirmRetype(expected, { input, output });
    input.write(`${typed}\n`);
    return p;
  }

  it("returns true on an exact match", async () => {
    expect(await run("sector-1", "sector-1")).toBe(true);
  });

  it("returns false on a mismatch", async () => {
    expect(await run("sector-2", "sector-1")).toBe(false);
  });

  it("trims surrounding whitespace before comparing", async () => {
    expect(await run("  sector-1  ", "sector-1")).toBe(true);
  });
});

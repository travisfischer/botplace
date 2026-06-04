// Unit tests for the pure helpers in scripts/admin/_common.mjs. No DB.

import { describe, expect, it } from "vitest";

import { PassThrough } from "node:stream";

import { dbUrlWithSsl, confirmRetype } from "@/scripts/admin/_common.mjs";

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

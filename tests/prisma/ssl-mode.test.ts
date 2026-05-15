// `normalizeSslMode` is the boundary between operator-supplied
// connection strings and the pg driver. It forces every connection up
// to `sslmode=verify-full` so a future pg-driver default change (where
// `require`/`prefer`/`verify-ca` stop verifying certs) can't silently
// regress production. The escape hatch for `sslmode=disable` is
// explicit and intentional — non-TLS hosts (CI service containers, in-
// process test fixtures) can opt out, but only by typing the literal
// "disable" into the URL. Production / preview URLs never set that.

import { describe, expect, it } from "vitest";

import { _normalizeSslModeForTest as normalizeSslMode } from "@/lib/prisma";

describe("normalizeSslMode", () => {
  it("forces sslmode=verify-full when sslmode is unset", () => {
    expect(normalizeSslMode("postgresql://u:p@host/db")).toContain(
      "sslmode=verify-full",
    );
  });

  it.each([
    "postgresql://u:p@host/db?sslmode=require",
    "postgresql://u:p@host/db?sslmode=prefer",
    "postgresql://u:p@host/db?sslmode=verify-ca",
    "postgresql://u:p@host/db?sslmode=allow",
    "postgresql://u:p@host/db?sslmode=verify-full",
  ])("normalizes upward from %s", (input) => {
    expect(normalizeSslMode(input)).toContain("sslmode=verify-full");
    expect(normalizeSslMode(input)).not.toContain("sslmode=require");
    expect(normalizeSslMode(input)).not.toContain("sslmode=prefer");
  });

  it("respects an explicit sslmode=disable (opt-out for CI / non-TLS hosts)", () => {
    const result = normalizeSslMode(
      "postgresql://u:p@localhost:5432/db?sslmode=disable",
    );
    expect(result).toContain("sslmode=disable");
    expect(result).not.toContain("verify-full");
  });

  it("passes through undefined and unparseable inputs", () => {
    expect(normalizeSslMode(undefined)).toBeUndefined();
    expect(normalizeSslMode("not a url")).toBe("not a url");
  });
});

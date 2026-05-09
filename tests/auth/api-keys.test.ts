import { describe, expect, it } from "vitest";
import {
  assertPepper,
  hashKey,
  mintKey,
  parseAuthHeader,
  verifyKey,
} from "@/src/auth/api-keys";

const PEPPER = "a".repeat(64);
const OTHER_PEPPER = "b".repeat(64);
const SHORT_PEPPER = "a".repeat(32);

describe("mintKey", () => {
  it("returns a plaintext that starts with the kind tag", () => {
    const key = mintKey("bp_live", PEPPER);
    expect(key.plaintext.startsWith("bp_live_")).toBe(true);
  });

  it("returns a hash that matches hashKey(plaintext, pepper)", () => {
    const key = mintKey("bp_live", PEPPER);
    expect(key.hash).toBe(hashKey(key.plaintext, PEPPER));
  });

  it("returns a display prefix of the form <kind>_<8-base64url>", () => {
    const key = mintKey("bp_live", PEPPER);
    expect(key.prefix).toMatch(/^bp_live_[A-Za-z0-9_-]{8}$/);
  });

  it("produces a different plaintext on each call", () => {
    const a = mintKey("bp_live", PEPPER);
    const b = mintKey("bp_live", PEPPER);
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });

  it("supports the bp_pat prefix for personal access tokens", () => {
    const key = mintKey("bp_pat", PEPPER);
    expect(key.plaintext.startsWith("bp_pat_")).toBe(true);
    expect(key.prefix).toMatch(/^bp_pat_[A-Za-z0-9_-]{8}$/);
  });

  it("refuses to mint when pepper is missing", () => {
    expect(() => mintKey("bp_live", "")).toThrow(/PEPPER missing/i);
  });
});

describe("hashKey", () => {
  it("is deterministic for the same plaintext + pepper", () => {
    expect(hashKey("bp_live_test", PEPPER)).toBe(
      hashKey("bp_live_test", PEPPER),
    );
  });

  it("differs for different plaintexts", () => {
    expect(hashKey("a", PEPPER)).not.toBe(hashKey("b", PEPPER));
  });

  it("differs for different peppers", () => {
    expect(hashKey("same", PEPPER)).not.toBe(hashKey("same", OTHER_PEPPER));
  });

  it("returns 64-char lowercase hex", () => {
    expect(hashKey("anything", PEPPER)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to hash with a missing pepper", () => {
    expect(() => hashKey("anything", "")).toThrow(/PEPPER missing/i);
  });
});

describe("verifyKey", () => {
  it("returns true for a key minted with the same pepper", () => {
    const key = mintKey("bp_live", PEPPER);
    expect(verifyKey(key.plaintext, key.hash, PEPPER)).toBe(true);
  });

  it("returns false when plaintext is wrong", () => {
    const key = mintKey("bp_live", PEPPER);
    expect(verifyKey("bp_live_other", key.hash, PEPPER)).toBe(false);
  });

  it("returns false when pepper is wrong", () => {
    const key = mintKey("bp_live", PEPPER);
    expect(verifyKey(key.plaintext, key.hash, OTHER_PEPPER)).toBe(false);
  });

  it("returns false when expectedHash is shorter than 64 chars", () => {
    const key = mintKey("bp_live", PEPPER);
    expect(verifyKey(key.plaintext, "abc", PEPPER)).toBe(false);
  });

  it("returns false when expectedHash is non-hex garbage of the right length", () => {
    const key = mintKey("bp_live", PEPPER);
    expect(verifyKey(key.plaintext, "g".repeat(64), PEPPER)).toBe(false);
  });
});

describe("parseAuthHeader", () => {
  it("extracts the token after 'Bearer '", () => {
    expect(parseAuthHeader("Bearer bp_live_abc123")).toBe("bp_live_abc123");
  });

  it("matches 'bearer' case-insensitively (RFC 6750)", () => {
    expect(parseAuthHeader("bearer bp_live_abc")).toBe("bp_live_abc");
    expect(parseAuthHeader("BEARER bp_live_abc")).toBe("bp_live_abc");
  });

  it("returns null for null/undefined/empty", () => {
    expect(parseAuthHeader(null)).toBeNull();
    expect(parseAuthHeader(undefined)).toBeNull();
    expect(parseAuthHeader("")).toBeNull();
  });

  it("returns null when scheme is missing", () => {
    expect(parseAuthHeader("bp_live_abc")).toBeNull();
  });

  it("returns null when token contains internal whitespace", () => {
    expect(parseAuthHeader("Bearer two tokens")).toBeNull();
  });

  it("returns null for unrelated schemes", () => {
    expect(parseAuthHeader("Basic dXNlcjpwYXNz")).toBeNull();
  });
});

describe("assertPepper", () => {
  it("throws on undefined", () => {
    expect(() => assertPepper(undefined)).toThrow(/missing or too short/i);
  });

  it("throws on null", () => {
    expect(() => assertPepper(null)).toThrow(/missing or too short/i);
  });

  it("throws on empty string", () => {
    expect(() => assertPepper("")).toThrow(/missing or too short/i);
  });

  it("throws on a too-short pepper", () => {
    expect(() => assertPepper(SHORT_PEPPER)).toThrow(/missing or too short/i);
  });

  it("passes for a 64-char (32-byte hex) pepper", () => {
    expect(() => assertPepper(PEPPER)).not.toThrow();
  });
});

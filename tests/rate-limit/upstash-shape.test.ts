// Validate the shape-coercion helper in `lib/rate-limit.ts`. The Upstash
// client is the rate-limiter dependency: malformed responses (provider
// outage, hostile proxy, version mismatch) must fail closed, not silently
// admit traffic at the default of "success: true". Anything other than the
// expected shape throws; the caller turns the throw into a 503
// `rate_limit_unavailable`.

import { describe, expect, it } from "vitest";

import { coerceUpstashResult } from "@/lib/rate-limit";

describe("coerceUpstashResult", () => {
  it("returns normalized result on a valid response", () => {
    const result = coerceUpstashResult({
      success: true,
      reset: 1700000000,
      remaining: 5,
    });
    expect(result).toEqual({ success: true, reset: 1700000000, remaining: 5 });
  });

  it("defaults `remaining` to 0 when missing or non-numeric", () => {
    const a = coerceUpstashResult({ success: false, reset: 1700000000 });
    expect(a.remaining).toBe(0);
    const b = coerceUpstashResult({
      success: false,
      reset: 1700000000,
      remaining: "??",
    });
    expect(b.remaining).toBe(0);
  });

  it("throws when `success` is undefined", () => {
    expect(() =>
      coerceUpstashResult({ reset: 1700000000, remaining: 1 }),
    ).toThrow("upstash_malformed_response");
  });

  it("throws when `success` is not a boolean", () => {
    expect(() =>
      coerceUpstashResult({ success: "true", reset: 1700000000 }),
    ).toThrow("upstash_malformed_response");
  });

  it("throws when `reset` is missing", () => {
    expect(() => coerceUpstashResult({ success: true })).toThrow(
      "upstash_malformed_response",
    );
  });

  it("throws when `reset` is not a number", () => {
    expect(() =>
      coerceUpstashResult({ success: true, reset: "later" }),
    ).toThrow("upstash_malformed_response");
  });

  it("throws on null / non-object input", () => {
    expect(() => coerceUpstashResult(null)).toThrow(
      "upstash_malformed_response",
    );
    expect(() => coerceUpstashResult("ok")).toThrow(
      "upstash_malformed_response",
    );
    expect(() => coerceUpstashResult(undefined)).toThrow(
      "upstash_malformed_response",
    );
  });
});

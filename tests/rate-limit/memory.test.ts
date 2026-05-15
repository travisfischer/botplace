import { describe, expect, it } from "vitest";
import { MemoryTokenBucket } from "@/lib/rate-limit-memory";

describe("MemoryTokenBucket", () => {
  it("first call on a fresh bucket succeeds", async () => {
    const b = new MemoryTokenBucket(1, 60_000);
    const r = await b.limit("test");
    expect(r.success).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it("second call within the refill window fails", async () => {
    const b = new MemoryTokenBucket(1, 60_000);
    await b.limit("test");
    expect((await b.limit("test")).success).toBe(false);
  });

  it("refills exactly one token after the interval elapses", async () => {
    let now = 1_000_000;
    const b = new MemoryTokenBucket(1, 60_000, () => now);
    await b.limit("test");
    expect((await b.limit("test")).success).toBe(false);
    now += 60_000;
    expect((await b.limit("test")).success).toBe(true);
    expect((await b.limit("test")).success).toBe(false);
  });

  it("does not over-refill on long idle (cap = capacity)", async () => {
    let now = 1_000_000;
    const b = new MemoryTokenBucket(1, 60_000, () => now);
    await b.limit("test"); // consume initial token
    now += 600_000; // 10 intervals later
    expect((await b.limit("test")).success).toBe(true);
    // Still capped at 1 — second consecutive call must fail.
    expect((await b.limit("test")).success).toBe(false);
  });

  it("isolates buckets by key", async () => {
    const b = new MemoryTokenBucket(1, 60_000);
    expect((await b.limit("a")).success).toBe(true);
    expect((await b.limit("b")).success).toBe(true);
    expect((await b.limit("a")).success).toBe(false);
    expect((await b.limit("b")).success).toBe(false);
  });

  it("`reset` is the next-token time aligned to the interval", async () => {
    let now = 1_000_000;
    const b = new MemoryTokenBucket(1, 60_000, () => now);
    const r1 = await b.limit("test");
    expect(r1.reset).toBe(now + 60_000);
    // Halfway into the interval, `reset` is still the same (lastRefill unchanged).
    now += 30_000;
    const r2 = await b.limit("test");
    expect(r2.success).toBe(false);
    expect(r2.reset).toBe(1_000_000 + 60_000);
  });

  it("supports capacity > 1", async () => {
    const b = new MemoryTokenBucket(3, 60_000);
    expect((await b.limit("k")).remaining).toBe(2);
    expect((await b.limit("k")).remaining).toBe(1);
    expect((await b.limit("k")).remaining).toBe(0);
    expect((await b.limit("k")).success).toBe(false);
  });

  describe("refillRate", () => {
    it("defaults to 1 token per interval (drip refill, M2.5 semantics)", async () => {
      let now = 1_000_000;
      // Default refillRate via positional-arg omission.
      const b = new MemoryTokenBucket(60, 1_000, () => now);
      // Drain.
      for (let i = 0; i < 60; i++) await b.limit("k");
      expect((await b.limit("k")).success).toBe(false);
      // After one interval, exactly one token has refilled.
      now += 1_000;
      expect((await b.limit("k")).success).toBe(true);
      expect((await b.limit("k")).success).toBe(false);
    });

    it("refillRate=N adds N tokens per interval (PUBLIC_READ semantics)", async () => {
      let now = 1_000_000;
      // The actual PUBLIC_READ shape after the M3 hotfix: 60 tokens
      // capacity, 60 tokens added per second.
      const b = new MemoryTokenBucket(60, 1_000, () => now, 60);
      // Drain.
      for (let i = 0; i < 60; i++) await b.limit("k");
      expect((await b.limit("k")).success).toBe(false);
      // After one second, the bucket is fully refilled to capacity.
      now += 1_000;
      // Should have 60 tokens ready.
      for (let i = 0; i < 60; i++) {
        expect((await b.limit("k")).success).toBe(true);
      }
      expect((await b.limit("k")).success).toBe(false);
    });

    it("refillRate * intervals does not exceed capacity (cap on long idle)", async () => {
      let now = 1_000_000;
      const b = new MemoryTokenBucket(60, 1_000, () => now, 60);
      // Drain to zero.
      for (let i = 0; i < 60; i++) await b.limit("k");
      // Idle for 10 intervals — would naively add 600 tokens.
      now += 10_000;
      // But capacity is 60, so the very first call after the idle
      // succeeds and 59 more do too (= one full bucket).
      let succeeded = 0;
      for (let i = 0; i < 100; i++) {
        if ((await b.limit("k")).success) succeeded++;
        else break;
      }
      expect(succeeded).toBe(60);
    });
  });
});

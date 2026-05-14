// M2.5 follow-up: graceful degradation when Upstash is unreachable.
// Read scopes (`read`, `publicRead`) wrap their Upstash limiter in a
// `FailOpenLimiter` so an outage falls back to an in-isolate memory
// bucket instead of returning 503 to every caller. Writes intentionally
// stay fail-closed — see `lib/rate-limit.ts` header for rationale.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FailOpenLimiter,
  __resetCircuitBreakerForTests,
} from "@/lib/rate-limit";
import {
  MemoryTokenBucket,
  type Limiter,
  type LimiterResult,
} from "@/lib/rate-limit-memory";

class ThrowingLimiter implements Limiter {
  public calls = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async limit(_key: string): Promise<LimiterResult> {
    this.calls += 1;
    throw new Error("upstash_timeout");
  }
}

class FlippableLimiter implements Limiter {
  public calls = 0;
  public throwing = true;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async limit(_key: string): Promise<LimiterResult> {
    this.calls += 1;
    if (this.throwing) throw new Error("upstash_timeout");
    return { success: true, reset: Date.now() + 1_000, remaining: 99 };
  }
}

describe("FailOpenLimiter", () => {
  beforeEach(() => {
    __resetCircuitBreakerForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetCircuitBreakerForTests();
  });

  it("returns the primary result when primary succeeds", async () => {
    let primaryCalls = 0;
    const primary: Limiter = {
      async limit(_k: string) {
        primaryCalls += 1;
        return { success: true, reset: 9_999, remaining: 42 };
      },
    };
    const fallback = new MemoryTokenBucket(1, 60_000);
    const limiter = new FailOpenLimiter("read", primary, fallback);

    const r = await limiter.limit("k");
    expect(r.success).toBe(true);
    expect(r.remaining).toBe(42);
    expect(primaryCalls).toBe(1);
  });

  it("falls back to the memory bucket when primary throws", async () => {
    const primary = new ThrowingLimiter();
    const fallback = new MemoryTokenBucket(1, 60_000);
    const limiter = new FailOpenLimiter("read", primary, fallback);

    const r = await limiter.limit("k");
    // Memory bucket has a fresh token → success.
    expect(r.success).toBe(true);
    expect(primary.calls).toBe(1);
  });

  it("opens the circuit after a failure: subsequent calls skip primary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));

    const primary = new ThrowingLimiter();
    const fallback = new MemoryTokenBucket(60, 1_000);
    const limiter = new FailOpenLimiter("read", primary, fallback);

    // First call exercises primary (throws), then falls back. Circuit opens.
    await limiter.limit("k");
    expect(primary.calls).toBe(1);

    // Subsequent calls within the circuit window must not touch primary.
    await limiter.limit("k");
    await limiter.limit("k");
    await limiter.limit("k");
    expect(primary.calls).toBe(1);
  });

  it("retries primary after the circuit window expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));

    const primary = new ThrowingLimiter();
    const fallback = new MemoryTokenBucket(60, 1_000);
    const limiter = new FailOpenLimiter("read", primary, fallback);

    await limiter.limit("k");
    expect(primary.calls).toBe(1);

    // Within window — no retry.
    vi.setSystemTime(new Date(1_000_000 + 10_000));
    await limiter.limit("k");
    expect(primary.calls).toBe(1);

    // Past window — primary retried (and throws again).
    vi.setSystemTime(new Date(1_000_000 + 31_000));
    await limiter.limit("k");
    expect(primary.calls).toBe(2);
  });

  it("primary recovers after the window: subsequent calls use primary again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));

    const primary = new FlippableLimiter();
    const fallback = new MemoryTokenBucket(60, 1_000);
    const limiter = new FailOpenLimiter("read", primary, fallback);

    // First call fails, circuit opens.
    const r1 = await limiter.limit("k");
    expect(r1.success).toBe(true); // memory fallback served it
    expect(primary.calls).toBe(1);

    // While circuit open, primary is skipped.
    vi.setSystemTime(new Date(1_000_000 + 10_000));
    await limiter.limit("k");
    expect(primary.calls).toBe(1);

    // Past window + primary healthy: primary tried, succeeds, returns its
    // own (different) shape so we can tell it was used.
    primary.throwing = false;
    vi.setSystemTime(new Date(1_000_000 + 31_000));
    const r2 = await limiter.limit("k");
    expect(primary.calls).toBe(2);
    expect(r2.remaining).toBe(99); // sentinel from FlippableLimiter

    // After recovery, further calls keep using primary.
    const r3 = await limiter.limit("k");
    expect(primary.calls).toBe(3);
    expect(r3.remaining).toBe(99);
  });

  it("memory fallback still enforces a per-isolate ceiling", async () => {
    // A capacity-1 fallback bucket: first call open, second blocked. Proves
    // the fail-open path doesn't admit unlimited traffic during an outage.
    const primary = new ThrowingLimiter();
    const fallback = new MemoryTokenBucket(1, 60_000);
    const limiter = new FailOpenLimiter("read", primary, fallback);

    const r1 = await limiter.limit("same-key");
    expect(r1.success).toBe(true);

    const r2 = await limiter.limit("same-key");
    expect(r2.success).toBe(false);
  });
});

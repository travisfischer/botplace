// Poll-loop unit tests. Uses vitest fake timers to advance time
// deterministically. The tick fn is a stub, so no real network involved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PollLoop, nextBackoff } from "@/src/viewer/poll-loop";

describe("nextBackoff", () => {
  it("starts at intervalMs when current = 0", () => {
    expect(nextBackoff(0, { intervalMs: 1000 })).toBe(1000);
  });

  it("doubles each call", () => {
    expect(nextBackoff(1000, { intervalMs: 1000 })).toBe(2000);
    expect(nextBackoff(2000, { intervalMs: 1000 })).toBe(4000);
  });

  it("caps at maxBackoffMs", () => {
    expect(nextBackoff(20_000, { intervalMs: 1000, maxBackoffMs: 30_000 })).toBe(
      30_000,
    );
    expect(nextBackoff(30_000, { intervalMs: 1000, maxBackoffMs: 30_000 })).toBe(
      30_000,
    );
  });
});

describe("PollLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the first tick immediately on start, then every intervalMs", async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const loop = new PollLoop({ tick, intervalMs: 1000 });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(3);
    loop.stop();
  });

  it("doubles backoff on errors and resets on success", async () => {
    let throwCount = 2;
    const tick = vi.fn().mockImplementation(async () => {
      if (throwCount-- > 0) throw new Error("boom");
    });
    const onError = vi.fn();
    const loop = new PollLoop({ tick, intervalMs: 1000, onError });
    loop.start();

    // First tick: throws. Backoff = 1000ms.
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    // After 1000ms, second tick fires (still throws). Backoff = 2000ms.
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);

    // After 2000ms, third tick fires (succeeds). Backoff resets.
    await vi.advanceTimersByTimeAsync(2000);
    expect(tick).toHaveBeenCalledTimes(3);

    // Next tick is back at the normal 1000ms interval.
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(4);

    loop.stop();
  });

  it("aborts the in-flight tick on stop()", async () => {
    let aborted = false;
    const tick = vi.fn().mockImplementation((signal: AbortSignal) => {
      return new Promise<void>((_, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const onError = vi.fn();
    const loop = new PollLoop({ tick, intervalMs: 1000, onError });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    loop.stop();
    // Allow microtask queue to drain so the abort propagates.
    await vi.advanceTimersByTimeAsync(0);
    expect(aborted).toBe(true);
    // AbortError should NOT be reported as an onError.
    expect(onError).not.toHaveBeenCalled();
  });

  it("respects Retry-After floor on RateLimitedError", async () => {
    let throwOnce = true;
    const tick = vi.fn().mockImplementation(async () => {
      if (throwOnce) {
        throwOnce = false;
        throw Object.assign(new Error("manifest 429"), {
          name: "RateLimitedError",
          retryAfterSeconds: 5,
        });
      }
    });
    const onError = vi.fn();
    const loop = new PollLoop({ tick, intervalMs: 1000, onError });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    // Exponential backoff would schedule the next tick at 1000ms.
    // Retry-After (5s) should win — no tick at 1000ms or 2000ms.
    await vi.advanceTimersByTimeAsync(2000);
    expect(tick).toHaveBeenCalledTimes(1);

    // Tick fires at 5000ms.
    await vi.advanceTimersByTimeAsync(3001);
    expect(tick).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it("flips status.healthy = false after `unhealthyAfter` consecutive failures", async () => {
    const tick = vi.fn().mockRejectedValue(new Error("boom"));
    const onError = vi.fn();
    const onStatusChange = vi.fn();
    const loop = new PollLoop({
      tick,
      intervalMs: 1000,
      unhealthyAfter: 3,
      onError,
      onStatusChange,
    });
    loop.start();

    // Failure 1 — still healthy (1 < 3).
    await vi.advanceTimersByTimeAsync(0);
    expect(loop.status().consecutiveFailures).toBe(1);
    expect(loop.status().healthy).toBe(true);
    expect(onStatusChange).not.toHaveBeenCalled();

    // Failure 2 — backoff = 1000ms; still healthy (2 < 3).
    await vi.advanceTimersByTimeAsync(1000);
    expect(loop.status().consecutiveFailures).toBe(2);
    expect(loop.status().healthy).toBe(true);

    // Failure 3 — backoff = 2000ms; flips to unhealthy.
    await vi.advanceTimersByTimeAsync(2000);
    expect(loop.status().consecutiveFailures).toBe(3);
    expect(loop.status().healthy).toBe(false);
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ healthy: false, consecutiveFailures: 3 }),
    );
    loop.stop();
  });

  it("flips status.healthy back to true on the first success after a streak", async () => {
    let failCount = 3;
    const tick = vi.fn().mockImplementation(async () => {
      if (failCount-- > 0) throw new Error("boom");
    });
    const onStatusChange = vi.fn();
    const loop = new PollLoop({
      tick,
      intervalMs: 1000,
      unhealthyAfter: 3,
      onError: () => {},
      onStatusChange,
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0); // fail 1
    await vi.advanceTimersByTimeAsync(1000); // fail 2
    await vi.advanceTimersByTimeAsync(2000); // fail 3 → unhealthy
    expect(onStatusChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ healthy: false }),
    );

    await vi.advanceTimersByTimeAsync(4000); // success → healthy
    expect(loop.status().healthy).toBe(true);
    expect(loop.status().consecutiveFailures).toBe(0);
    expect(onStatusChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ healthy: true }),
    );
    loop.stop();
  });

  it("pause cancels the timer; resume re-arms it", async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const loop = new PollLoop({ tick, intervalMs: 1000 });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    loop.pause();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(1); // no new ticks while paused

    loop.resume();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    loop.stop();
  });
});

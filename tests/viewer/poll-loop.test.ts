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

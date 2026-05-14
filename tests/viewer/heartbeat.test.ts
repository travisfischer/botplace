// Heartbeat unit tests. Uses vitest fake timers + a fetch stub —
// no real network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHeartbeat } from "@/src/viewer/heartbeat";

function makeFetchStub() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(
    async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 204 });
    },
  );
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("createHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once immediately on start, then on every interval", async () => {
    const { fetchImpl, calls } = makeFetchStub();
    const hb = createHeartbeat("sector-1", { fetchImpl, intervalMs: 60_000 });

    hb.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.length).toBe(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.length).toBe(3);

    hb.stop();
  });

  it("POSTs to the per-sector heartbeat path with credentials omitted", async () => {
    const { fetchImpl, calls } = makeFetchStub();
    const hb = createHeartbeat("alpha", { fetchImpl });
    hb.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(calls[0].url).toBe("/api/v1/public/sectors/alpha/heartbeat");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.credentials).toBe("omit");
    expect(calls[0].init?.keepalive).toBe(true);
    hb.stop();
  });

  it("stop() cancels the interval and aborts in-flight requests", async () => {
    const { fetchImpl, calls } = makeFetchStub();
    const hb = createHeartbeat("s", { fetchImpl, intervalMs: 5_000 });

    hb.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(1);

    hb.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.length).toBe(1);

    // Signal was aborted on stop.
    expect(calls[0].init?.signal?.aborted).toBe(true);
  });

  it("start() is idempotent — calling twice doesn't schedule two intervals", async () => {
    const { fetchImpl, calls } = makeFetchStub();
    const hb = createHeartbeat("s", { fetchImpl, intervalMs: 10_000 });
    hb.start();
    hb.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.length).toBe(2);
    hb.stop();
  });

  it("swallows fetch failures so a network blip doesn't crash the viewer", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    const hb = createHeartbeat("s", { fetchImpl, intervalMs: 1_000 });
    hb.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    // No throw escapes — the test simply reaches here.
    expect(true).toBe(true);
    hb.stop();
  });
});

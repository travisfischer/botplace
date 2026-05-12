// Tier-aware pixel write rate limit. Verifies M2.5's POWER tier hits a
// different (faster) per-bot bucket than FREE, and bypasses the per-IP
// bucket entirely.
//
// Runs against the in-memory backend (no Upstash needed): module-level
// state in lib/rate-limit.ts caches the bucket instances across test
// cases, so each test that exercises rate limits uses a unique
// botKey/ip pair to avoid cross-test contamination.

import { afterEach, describe, expect, it, vi } from "vitest";

import { checkPixelWriteRateLimit } from "@/lib/rate-limit";

// In-memory rate-limit buckets persist across tests in the same vitest
// run. To prevent cross-test contamination on IP and bot-key state, each
// test draws unique keys from a monotonic per-suite counter.
let _ipCounter = 0;
function uniqueIp(): string {
  _ipCounter += 1;
  // Spread across the 203.0.113.0/24 documentation prefix (RFC 5737).
  const octet = (_ipCounter % 250) + 1;
  return `203.0.113.${octet}.t${_ipCounter}`;
}
function uniqueBotKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("checkPixelWriteRateLimit — tier semantics", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("FREE tier: per-bot 1/60s — second call within window fails", async () => {
    const botKey = uniqueBotKey("free-bot");
    const ip = uniqueIp();

    const r1 = await checkPixelWriteRateLimit({ botKey, ip, tier: "FREE" });
    expect(r1.ok).toBe(true);

    const r2 = await checkPixelWriteRateLimit({ botKey, ip, tier: "FREE" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.reason).toBe("rate_limited");
      // Should be the bot bucket that ran out (capacity 1, refill 60s).
      if (r2.reason === "rate_limited") expect(r2.scope).toBe("bot");
    }
  });

  it("POWER tier: per-bot 1/sec/cap-60 — burst of 60 succeeds, 61st fails", async () => {
    const botKey = uniqueBotKey("power-bot");
    const ip = uniqueIp();

    // 60 should fit comfortably in the POWER bot bucket (capacity 60).
    for (let i = 0; i < 60; i++) {
      const r = await checkPixelWriteRateLimit({ botKey, ip, tier: "POWER" });
      expect(r.ok, `request ${i + 1} should succeed`).toBe(true);
    }
    const overflow = await checkPixelWriteRateLimit({ botKey, ip, tier: "POWER" });
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.reason).toBe("rate_limited");
      if (overflow.reason === "rate_limited") {
        // Should be the bot bucket that ran out — POWER tier never
        // touched the per-IP bucket.
        expect(overflow.scope).toBe("bot");
      }
    }
  });

  it("POWER tier: per-IP bucket is bypassed (many bots from same IP can all write)", async () => {
    const ip = uniqueIp();

    // Three different POWER bots from the same IP should each succeed
    // even though the per-IP FREE bucket would block them past the first
    // write per 60s.
    const r1 = await checkPixelWriteRateLimit({
      botKey: uniqueBotKey("power-bot-a"),
      ip,
      tier: "POWER",
    });
    const r2 = await checkPixelWriteRateLimit({
      botKey: uniqueBotKey("power-bot-b"),
      ip,
      tier: "POWER",
    });
    const r3 = await checkPixelWriteRateLimit({
      botKey: uniqueBotKey("power-bot-c"),
      ip,
      tier: "POWER",
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
  });

  it("FREE tier: per-IP bucket DOES throttle multiple bots from same IP", async () => {
    const ip = uniqueIp();

    // First write succeeds.
    const r1 = await checkPixelWriteRateLimit({
      botKey: uniqueBotKey("free-bot-a"),
      ip,
      tier: "FREE",
    });
    expect(r1.ok).toBe(true);

    // Second bot, same IP, within 60s — per-IP bucket should reject.
    const r2 = await checkPixelWriteRateLimit({
      botKey: uniqueBotKey("free-bot-b"),
      ip,
      tier: "FREE",
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok && r2.reason === "rate_limited") {
      expect(r2.scope).toBe("ip");
    }
  });

  it("defaults to FREE behavior when tier is omitted (back-compat)", async () => {
    const botKey = uniqueBotKey("default-bot");
    const ip = uniqueIp();

    const r1 = await checkPixelWriteRateLimit({ botKey, ip });
    expect(r1.ok).toBe(true);

    const r2 = await checkPixelWriteRateLimit({ botKey, ip });
    expect(r2.ok).toBe(false);
  });

  // The defining property of POWER vs FREE isn't the burst capacity
  // (which both tests above cover) — it's the refill rate. A regression
  // that swapped `refillIntervalMs: 1_000` → `60_000` (capacity 60,
  // refill 60s) would pass every other tier test in this file and
  // silently break every M2.5 launch bot. Fake timers let us assert the
  // contract: at ~1.1s after a POWER bucket is drained, the next write
  // succeeds; at ~1.1s after a FREE bucket is drained, the next write
  // still fails; at ~61s after a FREE bucket is drained, the next write
  // succeeds.
  it("POWER tier: per-bot bucket refills at ~1 token/sec", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T12:00:00.000Z"));

    const botKey = uniqueBotKey("power-refill-bot");
    const ip = uniqueIp();

    // Drain the bucket.
    for (let i = 0; i < 60; i++) {
      const r = await checkPixelWriteRateLimit({ botKey, ip, tier: "POWER" });
      expect(r.ok, `drain request ${i + 1} should succeed`).toBe(true);
    }
    // 61st request fails — bucket empty.
    const overflow = await checkPixelWriteRateLimit({ botKey, ip, tier: "POWER" });
    expect(overflow.ok).toBe(false);

    // Advance time by 1.1s — one token should refill (1 / 1s).
    vi.setSystemTime(new Date("2026-05-12T12:00:01.100Z"));
    const refilled = await checkPixelWriteRateLimit({ botKey, ip, tier: "POWER" });
    expect(refilled.ok, "1.1s after drain, one token should have refilled").toBe(true);
    // And the next one fails again — we only got back one token.
    const overflowAgain = await checkPixelWriteRateLimit({ botKey, ip, tier: "POWER" });
    expect(overflowAgain.ok).toBe(false);
  });

  it("FREE tier: per-bot bucket refills at ~1 token/60s, NOT 1 token/sec", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T12:00:00.000Z"));

    const botKey = uniqueBotKey("free-refill-bot");
    const ip = uniqueIp();

    // First request succeeds (capacity 1).
    const r1 = await checkPixelWriteRateLimit({ botKey, ip, tier: "FREE" });
    expect(r1.ok).toBe(true);
    // Second request fails immediately.
    const r2 = await checkPixelWriteRateLimit({ botKey, ip, tier: "FREE" });
    expect(r2.ok).toBe(false);

    // 1.1s later — still fails. FREE tier doesn't refill at 1/sec.
    vi.setSystemTime(new Date("2026-05-12T12:00:01.100Z"));
    const stillThrottled = await checkPixelWriteRateLimit({
      botKey,
      ip,
      tier: "FREE",
    });
    expect(
      stillThrottled.ok,
      "FREE tier must NOT refill at 1.1s (would mean it picked up the POWER bucket)",
    ).toBe(false);

    // 61s later — token has refilled (1 per 60s). Use a fresh IP to
    // avoid the per-IP bucket interfering with the per-bot refill check.
    vi.setSystemTime(new Date("2026-05-12T12:01:01.100Z"));
    const refilled = await checkPixelWriteRateLimit({
      botKey,
      ip: uniqueIp(),
      tier: "FREE",
    });
    expect(refilled.ok, "FREE tier should refill its bot bucket after 60s").toBe(true);
  });
});

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

describe("checkPixelWriteRateLimit — tier semantics", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("FREE tier: per-bot 1/60s — second call within window fails", async () => {
    const botKey = "free-bot-" + Math.random().toString(36).slice(2);
    const ip = "203.0.113." + Math.floor(Math.random() * 254 + 1);

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
    const botKey = "power-bot-" + Math.random().toString(36).slice(2);
    const ip = "203.0.113." + Math.floor(Math.random() * 254 + 1);

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
    const ip = "203.0.113." + Math.floor(Math.random() * 254 + 1);

    // Three different POWER bots from the same IP should each succeed
    // even though the per-IP FREE bucket would block them past the first
    // write per 60s.
    const r1 = await checkPixelWriteRateLimit({
      botKey: "power-bot-a-" + Math.random().toString(36).slice(2),
      ip,
      tier: "POWER",
    });
    const r2 = await checkPixelWriteRateLimit({
      botKey: "power-bot-b-" + Math.random().toString(36).slice(2),
      ip,
      tier: "POWER",
    });
    const r3 = await checkPixelWriteRateLimit({
      botKey: "power-bot-c-" + Math.random().toString(36).slice(2),
      ip,
      tier: "POWER",
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
  });

  it("FREE tier: per-IP bucket DOES throttle multiple bots from same IP", async () => {
    const ip = "203.0.113." + Math.floor(Math.random() * 254 + 1);

    // First write succeeds.
    const r1 = await checkPixelWriteRateLimit({
      botKey: "free-bot-a-" + Math.random().toString(36).slice(2),
      ip,
      tier: "FREE",
    });
    expect(r1.ok).toBe(true);

    // Second bot, same IP, within 60s — per-IP bucket should reject.
    const r2 = await checkPixelWriteRateLimit({
      botKey: "free-bot-b-" + Math.random().toString(36).slice(2),
      ip,
      tier: "FREE",
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok && r2.reason === "rate_limited") {
      expect(r2.scope).toBe("ip");
    }
  });

  it("ADMIN tier behaves like POWER (faster bot bucket, no per-IP)", async () => {
    const ip = "203.0.113." + Math.floor(Math.random() * 254 + 1);

    const r1 = await checkPixelWriteRateLimit({
      botKey: "admin-bot-a-" + Math.random().toString(36).slice(2),
      ip,
      tier: "ADMIN",
    });
    const r2 = await checkPixelWriteRateLimit({
      botKey: "admin-bot-b-" + Math.random().toString(36).slice(2),
      ip,
      tier: "ADMIN",
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it("defaults to FREE behavior when tier is omitted (back-compat)", async () => {
    const botKey = "default-bot-" + Math.random().toString(36).slice(2);
    const ip = "203.0.113." + Math.floor(Math.random() * 254 + 1);

    const r1 = await checkPixelWriteRateLimit({ botKey, ip });
    expect(r1.ok).toBe(true);

    const r2 = await checkPixelWriteRateLimit({ botKey, ip });
    expect(r2.ok).toBe(false);
  });
});

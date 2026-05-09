// Rate limiter for the pixel API. Three buckets:
//   - per-bot-API-key (write): 1 token / 60s, capacity 1
//   - per-client-IP (write):   1 token / 60s, capacity 1
//   - per-caller (read):       1 token / 1s, capacity 60 (= 60/min smooth)
//
// Backend selection:
//   - If a recognized Upstash env var pair is set, uses real Upstash.
//     `Redis.fromEnv()` auto-detects either naming convention:
//       * `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (canonical Upstash SDK)
//       * `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Vercel↔Upstash Marketplace integration default)
//     Production requires one of these pairs.
//   - Else, in dev (`NODE_ENV !== 'production'`), falls back to an
//     in-process memory bucket (see `rate-limit-memory.ts`). No external
//     setup required — matches the disposable-per-branch pattern used for
//     Neon dev branches, dev pepper, and dev `AUTH_SECRET`.
//   - Else (production with missing env), throws at first call. Fail-closed
//     and the route handler returns 503.
//
// For pixel writes, both bot AND ip buckets must succeed. Sequential
// check: bot first, then IP. Asymmetric token consumption on partial
// failure is the documented gap (M1 review T4) — generous refill makes
// it harmless in practice.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { log } from "./log";
import {
  MemoryTokenBucket,
  type Limiter,
  type LimiterResult,
} from "./rate-limit-memory";

type Duration = `${number} ${"ms" | "s" | "m" | "h" | "d"}`;

interface BucketConfig {
  /** Max tokens the bucket can hold. */
  capacity: number;
  /** ms between automatic refill events (each adds 1 token). */
  refillIntervalMs: number;
  /** Upstash duration string equivalent, e.g. "60 s" or "1 s". */
  refillIntervalString: Duration;
  /** Redis key prefix; namespaces this limiter from other ones. */
  prefix: string;
}

const WRITE_BOT: BucketConfig = {
  capacity: 1,
  refillIntervalMs: 60_000,
  refillIntervalString: "60 s",
  prefix: "botplace:rl:bot",
};
const WRITE_IP: BucketConfig = {
  capacity: 1,
  refillIntervalMs: 60_000,
  refillIntervalString: "60 s",
  prefix: "botplace:rl:ip",
};
const READ: BucketConfig = {
  capacity: 60,
  refillIntervalMs: 1_000,
  refillIntervalString: "1 s",
  prefix: "botplace:rl:read",
};
// Per-owner cap on the credential-management mutations (create bot, mint
// key, rotate, mint PAT). 30/min is generous for the human form path and
// still bounds blast radius if a PAT is stolen — the attacker can't churn
// thousands of bots before the legitimate owner notices.
const OWNER_WRITE: BucketConfig = {
  capacity: 30,
  refillIntervalMs: 2_000,
  refillIntervalString: "2 s",
  prefix: "botplace:rl:owner_write",
};

interface LimiterCache {
  bot: Limiter;
  ip: Limiter;
  read: Limiter;
  ownerWrite: Limiter;
}

let cached: LimiterCache | null = null;
let warnedMemoryFallback = false;

/**
 * Validate + normalize an Upstash `Ratelimit#limit` result. Exported only
 * for tests — fail-closed against malformed responses. Caller catches the
 * throw and surfaces it as `rate_limit_unavailable` (503).
 */
export function coerceUpstashResult(raw: unknown): LimiterResult {
  if (raw === null || typeof raw !== "object") {
    throw new Error("upstash_malformed_response");
  }
  const r = raw as { success?: unknown; reset?: unknown; remaining?: unknown };
  if (typeof r.success !== "boolean" || typeof r.reset !== "number") {
    throw new Error("upstash_malformed_response");
  }
  return {
    success: r.success,
    reset: r.reset,
    remaining: typeof r.remaining === "number" ? r.remaining : 0,
  };
}

/**
 * Per-call Upstash timeout. "Fail-closed" only applies if the call returns
 * — a hung connection that never resolves would block the request thread
 * until Vercel's invocation timeout fires (multiple seconds). 2 seconds
 * is well above p99 Upstash latency and well under the runtime's outer
 * timeout, so a transient outage degrades to 503 quickly.
 */
const UPSTASH_TIMEOUT_MS = 2_000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("upstash_timeout")),
      ms,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function adaptUpstashLimiter(redis: Redis, cfg: BucketConfig): Limiter {
  const r = new Ratelimit({
    redis,
    limiter: Ratelimit.tokenBucket(1, cfg.refillIntervalString, cfg.capacity),
    prefix: cfg.prefix,
  });
  return {
    async limit(key: string): Promise<LimiterResult> {
      return coerceUpstashResult(
        await withTimeout(r.limit(key), UPSTASH_TIMEOUT_MS),
      );
    },
  };
}

function getLimiters(): LimiterCache {
  if (cached) return cached;

  // Either canonical Upstash names OR Vercel↔Upstash integration names.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (url && token) {
    const redis = new Redis({ url, token });
    cached = {
      bot: adaptUpstashLimiter(redis, WRITE_BOT),
      ip: adaptUpstashLimiter(redis, WRITE_IP),
      read: adaptUpstashLimiter(redis, READ),
      ownerWrite: adaptUpstashLimiter(redis, OWNER_WRITE),
    };
    return cached;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Upstash env missing in production: need either UPSTASH_REDIS_REST_URL/_TOKEN or KV_REST_API_URL/_TOKEN",
    );
  }

  if (!warnedMemoryFallback) {
    warnedMemoryFallback = true;
    log("warn", {
      dependency: "upstash",
      message:
        "Using in-process memory rate-limit fallback (no Upstash env set; NODE_ENV != 'production')",
    });
  }
  cached = {
    bot: new MemoryTokenBucket(WRITE_BOT.capacity, WRITE_BOT.refillIntervalMs),
    ip: new MemoryTokenBucket(WRITE_IP.capacity, WRITE_IP.refillIntervalMs),
    read: new MemoryTokenBucket(READ.capacity, READ.refillIntervalMs),
    ownerWrite: new MemoryTokenBucket(
      OWNER_WRITE.capacity,
      OWNER_WRITE.refillIntervalMs,
    ),
  };
  return cached;
}

export interface BucketState {
  /** Tokens left in the bucket after the most recent check. */
  remaining: number;
  /** ms since epoch at which the next token becomes available. */
  reset: number;
}

export type WriteRateLimitOutcome =
  | { ok: true; bot: BucketState; ip: BucketState }
  | {
      ok: false;
      reason: "rate_limited";
      scope: "bot" | "ip";
      bot: BucketState;
      ip: BucketState;
      retryAfterSeconds: number;
    }
  | { ok: false; reason: "rate_limit_unavailable" };

export type ReadRateLimitOutcome =
  | { ok: true; read: BucketState }
  | {
      ok: false;
      reason: "rate_limited";
      scope: "read";
      read: BucketState;
      retryAfterSeconds: number;
    }
  | { ok: false; reason: "rate_limit_unavailable" };

export type OwnerWriteRateLimitOutcome =
  | { ok: true; ownerWrite: BucketState }
  | {
      ok: false;
      reason: "rate_limited";
      scope: "owner_write";
      ownerWrite: BucketState;
      retryAfterSeconds: number;
    }
  | { ok: false; reason: "rate_limit_unavailable" };

function retryAfter(reset: number): number {
  return Math.max(1, Math.ceil((reset - Date.now()) / 1000));
}

function toState(r: LimiterResult): BucketState {
  return { remaining: r.remaining, reset: r.reset };
}

export async function checkPixelWriteRateLimit(input: {
  botKey: string;
  ip: string;
}): Promise<WriteRateLimitOutcome> {
  let limiters: LimiterCache;
  try {
    limiters = getLimiters();
  } catch {
    return { ok: false, reason: "rate_limit_unavailable" };
  }
  try {
    const botResult = await limiters.bot.limit(input.botKey);
    if (!botResult.success) {
      return {
        ok: false,
        reason: "rate_limited",
        scope: "bot",
        bot: toState(botResult),
        // IP bucket wasn't touched — give the caller a best-effort snapshot
        // (capacity full / reset window of the IP bucket) rather than
        // burning a token to learn its exact state.
        ip: { remaining: 1, reset: Date.now() + 60_000 },
        retryAfterSeconds: retryAfter(botResult.reset),
      };
    }
    const ipResult = await limiters.ip.limit(input.ip);
    if (!ipResult.success) {
      return {
        ok: false,
        reason: "rate_limited",
        scope: "ip",
        bot: toState(botResult),
        ip: toState(ipResult),
        retryAfterSeconds: retryAfter(ipResult.reset),
      };
    }
    return { ok: true, bot: toState(botResult), ip: toState(ipResult) };
  } catch {
    return { ok: false, reason: "rate_limit_unavailable" };
  }
}

/**
 * Per-caller rate limit for read endpoints. `callerKey` is whatever the
 * read auth resolver returned — an api key id, a PAT/owner id, or a
 * session-owner id. Prefix-namespaced so caller-key collisions across
 * credential types are impossible.
 */
export async function checkReadRateLimit(
  callerKey: string,
): Promise<ReadRateLimitOutcome> {
  let limiters: LimiterCache;
  try {
    limiters = getLimiters();
  } catch {
    return { ok: false, reason: "rate_limit_unavailable" };
  }
  try {
    const result = await limiters.read.limit(callerKey);
    if (!result.success) {
      return {
        ok: false,
        reason: "rate_limited",
        scope: "read",
        read: toState(result),
        retryAfterSeconds: retryAfter(result.reset),
      };
    }
    return { ok: true, read: toState(result) };
  } catch {
    return { ok: false, reason: "rate_limit_unavailable" };
  }
}

/**
 * Per-owner rate limit on credential-management mutations (create bot,
 * mint key, rotate, mint PAT, owner-driven revokes). Stops a stolen PAT
 * from churning the owner's credential surface faster than a human ever
 * would.
 */
export async function checkOwnerWriteRateLimit(
  ownerId: string,
): Promise<OwnerWriteRateLimitOutcome> {
  let limiters: LimiterCache;
  try {
    limiters = getLimiters();
  } catch {
    return { ok: false, reason: "rate_limit_unavailable" };
  }
  try {
    const result = await limiters.ownerWrite.limit(ownerId);
    if (!result.success) {
      return {
        ok: false,
        reason: "rate_limited",
        scope: "owner_write",
        ownerWrite: toState(result),
        retryAfterSeconds: retryAfter(result.reset),
      };
    }
    return { ok: true, ownerWrite: toState(result) };
  } catch {
    return { ok: false, reason: "rate_limit_unavailable" };
  }
}

/** Shape the four `X-RateLimit-*` headers per the M1 API contract. */
export function pixelWriteRateLimitHeaders(
  bot: BucketState,
  ip: BucketState,
  retryAfter?: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Remaining-Bot": String(bot.remaining),
    "X-RateLimit-Reset-Bot": String(Math.floor(bot.reset / 1000)),
    "X-RateLimit-Remaining-Ip": String(ip.remaining),
    "X-RateLimit-Reset-Ip": String(Math.floor(ip.reset / 1000)),
  };
  if (retryAfter !== undefined) headers["Retry-After"] = String(retryAfter);
  return headers;
}

export function readRateLimitHeaders(
  read: BucketState,
  retryAfter?: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Remaining-Read": String(read.remaining),
    "X-RateLimit-Reset-Read": String(Math.floor(read.reset / 1000)),
  };
  if (retryAfter !== undefined) headers["Retry-After"] = String(retryAfter);
  return headers;
}

export function ownerWriteRateLimitHeaders(
  ownerWrite: BucketState,
  retryAfter?: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Remaining-Owner-Write": String(ownerWrite.remaining),
    "X-RateLimit-Reset-Owner-Write": String(Math.floor(ownerWrite.reset / 1000)),
  };
  if (retryAfter !== undefined) headers["Retry-After"] = String(retryAfter);
  return headers;
}

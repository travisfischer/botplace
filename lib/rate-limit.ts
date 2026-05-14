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
//
// Fail policy by scope (per-scope graceful degradation; M2.5 follow-up):
//   - Reads (`read`, `publicRead`): fail OPEN to a per-isolate memory
//     bucket when Upstash is unreachable. A circuit breaker skips Upstash
//     entirely for `CIRCUIT_OPEN_MS` after a failure so we don't pay the
//     2s timeout on every request during a sustained outage. Rationale:
//     the Vercel Firewall edge rule (`docs/admin/v1.md`, 600/min/IP) is
//     the real public-read ceiling — the in-app bucket is the floor for
//     edge-bypass traffic. Per-isolate enforcement is weaker than global,
//     but the firewall covers the worst case.
//   - Writes (`bot`/`botPower`/`ip`, `ownerWrite`): fail CLOSED — the
//     Upstash bucket *is* the abuse defense for these paths. An outage
//     returning 503 is preferable to opening a flood gate.

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
// POWER tier per-bot write bucket. 1 token / 1s, capacity 60 — so a
// POWER bot can burst up to 60 writes immediately and then sustain 60
// writes/min indefinitely. POWER also bypasses the per-IP bucket (see
// checkPixelWriteRateLimit); both are M2.5 product features behind
// `Bot.rateTier`.
const WRITE_BOT_POWER: BucketConfig = {
  capacity: 60,
  refillIntervalMs: 1_000,
  refillIntervalString: "1 s",
  prefix: "botplace:rl:bot_power",
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
// Per-IP cap on anonymous public reads (M2 viewer endpoints). Sized
// generously so a legitimate viewer polling the manifest at 1Hz + an
// occasional chunk fetch never approaches the ceiling, while a
// determined scraper opening many paths in parallel does. 60/sec/IP
// (= 3600/min) is the in-app floor; the higher Vercel Firewall edge
// rule (600/min/IP per `docs/admin/v1.md`) sits *above* this, not
// below — i.e. attacks that bypass the edge for any reason still hit
// this app-side limit. M2 review P1.3.
const PUBLIC_READ: BucketConfig = {
  capacity: 60,
  refillIntervalMs: 1_000,
  refillIntervalString: "1 s",
  prefix: "botplace:rl:public_read",
};

interface LimiterCache {
  bot: Limiter;
  botPower: Limiter;
  ip: Limiter;
  read: Limiter;
  ownerWrite: Limiter;
  publicRead: Limiter;
}

let cached: LimiterCache | null = null;
let warnedMemoryFallback = false;

// Circuit breaker shared by the FailOpenLimiter wrappers. When Upstash
// throws (timeout, network, malformed response), the breaker opens for
// `CIRCUIT_OPEN_MS`; subsequent calls skip Upstash and go straight to
// the in-isolate memory bucket. After the window expires we try Upstash
// again — on success the circuit closes; on failure it re-opens.
//
// 30s strikes a balance: long enough that a sustained outage doesn't
// burn 2s of timeout per request, short enough that recovery from a
// brief blip is fast. Per-isolate state; Fluid Compute's instance
// reuse means the breaker amortizes across many requests.
const CIRCUIT_OPEN_MS = 30_000;
let circuitOpenedAt = 0;
let circuitWasOpen = false;

function circuitOpen(now: number): boolean {
  return now - circuitOpenedAt < CIRCUIT_OPEN_MS;
}

type FailOpenScope = "read" | "public_read";

function tripCircuit(scope: FailOpenScope, err: unknown): void {
  const wasOpen = circuitOpen(Date.now());
  circuitOpenedAt = Date.now();
  circuitWasOpen = true;
  if (!wasOpen) {
    log("warn", {
      dependency: "upstash",
      error_slug: "rate_limit_upstash_failed",
      rate_limit_scope: scope,
      error_class: err instanceof Error ? err.constructor.name : "unknown",
      message:
        "Upstash rate-limit failed; falling back to in-isolate memory bucket",
    });
  }
}

function noteCircuitRecovered(): void {
  if (circuitWasOpen) {
    circuitWasOpen = false;
    log("info", {
      dependency: "upstash",
      message: "Upstash rate-limit recovered; primary bucket back in use",
    });
  }
}

// Reset hook for tests; not exported to consumers.
export function __resetCircuitBreakerForTests(): void {
  circuitOpenedAt = 0;
  circuitWasOpen = false;
}

/**
 * Limiter wrapper that fails open to a per-isolate memory bucket when the
 * primary (Upstash) throws. Combined with the module-level circuit breaker,
 * a sustained Upstash outage degrades gracefully instead of returning 503
 * on every read.
 *
 * Used for `read` and `publicRead` only. Write scopes intentionally keep
 * the underlying Upstash adapter so an Upstash outage cannot become an
 * abuse-defense outage.
 */
export class FailOpenLimiter implements Limiter {
  constructor(
    private readonly scope: FailOpenScope,
    private readonly primary: Limiter,
    private readonly fallback: Limiter,
  ) {}

  async limit(key: string): Promise<LimiterResult> {
    if (circuitOpen(Date.now())) {
      return this.fallback.limit(key);
    }
    try {
      const result = await this.primary.limit(key);
      noteCircuitRecovered();
      return result;
    } catch (err) {
      tripCircuit(this.scope, err);
      return this.fallback.limit(key);
    }
  }
}

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
    // Wrap read limiters in FailOpenLimiter so Upstash outages degrade
    // to per-isolate memory buckets instead of 503ing every request.
    // Write limiters stay raw — see file header for the per-scope policy.
    cached = {
      bot: adaptUpstashLimiter(redis, WRITE_BOT),
      botPower: adaptUpstashLimiter(redis, WRITE_BOT_POWER),
      ip: adaptUpstashLimiter(redis, WRITE_IP),
      ownerWrite: adaptUpstashLimiter(redis, OWNER_WRITE),
      read: new FailOpenLimiter(
        "read",
        adaptUpstashLimiter(redis, READ),
        new MemoryTokenBucket(READ.capacity, READ.refillIntervalMs),
      ),
      publicRead: new FailOpenLimiter(
        "public_read",
        adaptUpstashLimiter(redis, PUBLIC_READ),
        new MemoryTokenBucket(
          PUBLIC_READ.capacity,
          PUBLIC_READ.refillIntervalMs,
        ),
      ),
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
    botPower: new MemoryTokenBucket(
      WRITE_BOT_POWER.capacity,
      WRITE_BOT_POWER.refillIntervalMs,
    ),
    ip: new MemoryTokenBucket(WRITE_IP.capacity, WRITE_IP.refillIntervalMs),
    read: new MemoryTokenBucket(READ.capacity, READ.refillIntervalMs),
    ownerWrite: new MemoryTokenBucket(
      OWNER_WRITE.capacity,
      OWNER_WRITE.refillIntervalMs,
    ),
    publicRead: new MemoryTokenBucket(
      PUBLIC_READ.capacity,
      PUBLIC_READ.refillIntervalMs,
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

export type PublicReadRateLimitOutcome =
  | { ok: true; publicRead: BucketState }
  | {
      ok: false;
      reason: "rate_limited";
      scope: "public_read";
      publicRead: BucketState;
      retryAfterSeconds: number;
    }
  | { ok: false; reason: "rate_limit_unavailable" };

function retryAfter(reset: number): number {
  return Math.max(1, Math.ceil((reset - Date.now()) / 1000));
}

function toState(r: LimiterResult): BucketState {
  return { remaining: r.remaining, reset: r.reset };
}

// Tier identifier mirrors `BotRateTier` from Prisma. Kept as a string
// union so this module doesn't import the Prisma client and stays
// usable from the Edge runtime (middleware).
export type RateTier = "FREE" | "POWER";

export async function checkPixelWriteRateLimit(input: {
  botKey: string;
  ip: string;
  // Defaults to FREE so existing call sites that haven't been updated
  // can't accidentally promote a bot to a faster bucket.
  tier?: RateTier;
}): Promise<WriteRateLimitOutcome> {
  const tier: RateTier = input.tier ?? "FREE";
  let limiters: LimiterCache;
  try {
    limiters = getLimiters();
  } catch {
    return { ok: false, reason: "rate_limit_unavailable" };
  }
  try {
    // FREE bots use the strict 1/60s bot bucket. POWER uses the
    // 1/sec/capacity-60 bucket. The per-IP bucket only applies to FREE
    // — POWER bots typically share an egress IP (Vercel function
    // origin, etc.) and the per-IP bucket would block them.
    const useBotBucket = tier === "FREE" ? limiters.bot : limiters.botPower;
    const botResult = await useBotBucket.limit(input.botKey);
    if (!botResult.success) {
      return {
        ok: false,
        reason: "rate_limited",
        scope: "bot",
        bot: toState(botResult),
        // IP bucket wasn't touched — give the caller a best-effort snapshot.
        ip: { remaining: 1, reset: Date.now() + 60_000 },
        retryAfterSeconds: retryAfter(botResult.reset),
      };
    }

    // POWER: skip the per-IP bucket entirely.
    if (tier !== "FREE") {
      return {
        ok: true,
        bot: toState(botResult),
        // No IP bucket touched; return a synthetic "wide open" snapshot
        // so response headers still reflect a remaining count.
        ip: { remaining: 1, reset: Date.now() + 60_000 },
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

/**
 * Per-IP rate limit on anonymous public reads. The Vercel Firewall edge
 * rule (per `docs/admin/v1.md`) is the first line; this app-level bucket
 * is the floor that catches anything bypassing the edge (Firewall outage,
 * regional config drift, internal traffic). 60/sec/IP is well above any
 * legitimate viewer's burst.
 */
export async function checkPublicReadRateLimit(
  ip: string,
): Promise<PublicReadRateLimitOutcome> {
  let limiters: LimiterCache;
  try {
    limiters = getLimiters();
  } catch {
    return { ok: false, reason: "rate_limit_unavailable" };
  }
  try {
    const result = await limiters.publicRead.limit(ip);
    if (!result.success) {
      return {
        ok: false,
        reason: "rate_limited",
        scope: "public_read",
        publicRead: toState(result),
        retryAfterSeconds: retryAfter(result.reset),
      };
    }
    return { ok: true, publicRead: toState(result) };
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

export function publicReadRateLimitHeaders(
  publicRead: BucketState,
  retryAfter?: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Remaining-Public-Read": String(publicRead.remaining),
    "X-RateLimit-Reset-Public-Read": String(Math.floor(publicRead.reset / 1000)),
  };
  if (retryAfter !== undefined) headers["Retry-After"] = String(retryAfter);
  return headers;
}

/**
 * Shared 429/503 response builder for the public read endpoints. Every
 * public route handler runs the rate-limit check at the top — this
 * function turns a non-ok outcome into the JSON Response with the right
 * headers and a structured log line.
 */
export function publicReadRateLimitResponse(
  outcome: Exclude<PublicReadRateLimitOutcome, { ok: true }>,
  context: { requestId: string; path: string; sectorId?: string; startedAt: number },
): Response {
  if (outcome.reason === "rate_limit_unavailable") {
    log("error", {
      request_id: context.requestId,
      path: context.path,
      status: 503,
      error_slug: "rate_limit_unavailable",
      auth_type: "public",
      sector_id: context.sectorId,
      dependency: "upstash",
      latency_ms: Date.now() - context.startedAt,
    });
    return Response.json(
      { error: "rate_limit_unavailable", request_id: context.requestId },
      {
        status: 503,
        // Tell well-behaved clients (incl. the viewer's PollLoop) to
        // back off when the limiter dependency is degraded. Without
        // this the viewer falls back to its 1s base backoff and can
        // hammer origin during an Upstash incident.
        headers: { "Retry-After": "5" },
      },
    );
  }
  log("warn", {
    request_id: context.requestId,
    path: context.path,
    status: 429,
    error_slug: "rate_limited",
    rate_limit_scope: "public_read",
    auth_type: "public",
    sector_id: context.sectorId,
    latency_ms: Date.now() - context.startedAt,
  });
  return Response.json(
    {
      error: "rate_limited",
      scope: "public_read",
      request_id: context.requestId,
    },
    {
      status: 429,
      headers: publicReadRateLimitHeaders(
        outcome.publicRead,
        outcome.retryAfterSeconds,
      ),
    },
  );
}

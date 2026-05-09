// In-process memory fallback for the rate limiter. Used when no Upstash
// credentials are configured AND `NODE_ENV !== 'production'`. Single-process,
// not shared across replicas — fine for `pnpm dev` and cloud-agent dev branches.
//
// Same `limit(key)` shape as `@upstash/ratelimit`'s `Ratelimit` so the rest
// of the rate-limit module doesn't care which is in use.

export interface LimiterResult {
  success: boolean;
  reset: number; // ms since epoch when the next token becomes available
  remaining: number;
}

export interface Limiter {
  limit(key: string): Promise<LimiterResult>;
}

interface BucketState {
  tokens: number;
  /** ms-since-epoch at which the bucket was last accounting-refreshed. */
  lastRefillMs: number;
}

/**
 * Token bucket with `capacity` max tokens and one refill every
 * `refillIntervalMs`. Fresh buckets start at capacity (first request always
 * succeeds). The `now` injection is for tests; production callers omit it
 * and get `Date.now` by default.
 */
export class MemoryTokenBucket implements Limiter {
  private readonly buckets = new Map<string, BucketState>();

  constructor(
    private readonly capacity: number,
    private readonly refillIntervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async limit(key: string): Promise<LimiterResult> {
    const t = this.now();
    const state = this.buckets.get(key) ?? {
      tokens: this.capacity,
      lastRefillMs: t,
    };

    // Account-refresh: how many full intervals have elapsed since lastRefillMs?
    const elapsed = t - state.lastRefillMs;
    if (elapsed >= this.refillIntervalMs) {
      const refills = Math.floor(elapsed / this.refillIntervalMs);
      state.tokens = Math.min(this.capacity, state.tokens + refills);
      state.lastRefillMs += refills * this.refillIntervalMs;
    }

    const success = state.tokens > 0;
    if (success) state.tokens -= 1;
    this.buckets.set(key, state);

    return {
      success,
      reset: state.lastRefillMs + this.refillIntervalMs,
      remaining: state.tokens,
    };
  }
}

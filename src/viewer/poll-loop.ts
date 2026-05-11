// Polling scheduler for the viewer. Pure scheduling logic — no fetch,
// no DOM. The component layer wires Page Visibility events into
// pause()/resume().
//
// Contract:
// - `start()` schedules ticks every `intervalMs` ms.
// - Each tick gets an `AbortSignal` so in-flight fetches cancel on stop.
// - On a thrown tick, the next tick is delayed via exponential backoff
//   (capped at `maxBackoffMs`). If the thrown error carries
//   `retryAfterSeconds` (RateLimitedError from viewer-fetch), the next
//   tick is delayed by AT LEAST that many seconds — honors the V3-spec'd
//   "respect Retry-After" contract.
// - Successful tick resets the backoff and bumps the success counter.
// - `pause()` / `resume()` are idempotent. While paused, the timer is
//   cleared; resuming re-arms it without firing immediately.
// - `stop()` aborts the current tick and prevents further scheduling.
// - `onStatusChange(status)` fires on every status transition. Status is
//   { healthy: boolean, consecutiveFailures: number }, intended for the
//   client component to render a "Reconnecting…" affordance after N
//   failures (see sector-viewer's stale-state logic, M2 review P2.4).

export interface PollLoopStatus {
  healthy: boolean;
  consecutiveFailures: number;
  /** Last time a tick succeeded, ms since epoch. 0 before any success. */
  lastSuccessAt: number;
}

export interface PollLoopOptions {
  /** Tick fn. Reject/throw → backoff. */
  tick: (signal: AbortSignal) => Promise<void>;
  /** Base poll interval. M2 target: 1000. */
  intervalMs: number;
  /** Cap on exponential-backoff delay between failing ticks. */
  maxBackoffMs?: number;
  /**
   * Threshold at which `healthy` flips to `false` in the status callback.
   * Default 3 — three consecutive failures means real degradation, not a
   * single transient blip.
   */
  unhealthyAfter?: number;
  /** Called when a tick throws. Default: console.warn. */
  onError?: (err: unknown) => void;
  /** Called on every status transition (healthy ↔ unhealthy). */
  onStatusChange?: (status: PollLoopStatus) => void;
}

export class PollLoop {
  private readonly opts: Required<
    Omit<PollLoopOptions, "onError" | "onStatusChange">
  > & {
    onError: (err: unknown) => void;
    onStatusChange: (status: PollLoopStatus) => void;
  };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private aborter: AbortController | null = null;
  private state: "stopped" | "running" | "paused" = "stopped";
  private backoffMs = 0;
  private consecutiveFailures = 0;
  private lastSuccessAt = 0;
  private wasHealthy = true;

  constructor(opts: PollLoopOptions) {
    this.opts = {
      tick: opts.tick,
      intervalMs: opts.intervalMs,
      maxBackoffMs: opts.maxBackoffMs ?? 30_000,
      unhealthyAfter: opts.unhealthyAfter ?? 3,
      onError: opts.onError ?? ((err) => console.warn("poll-loop tick", err)),
      onStatusChange: opts.onStatusChange ?? (() => {}),
    };
  }

  start(): void {
    if (this.state === "running") return;
    this.state = "running";
    this.scheduleNext(0);
  }

  stop(): void {
    this.state = "stopped";
    this.cancelTimer();
    this.abortInFlight();
    this.backoffMs = 0;
  }

  pause(): void {
    if (this.state !== "running") return;
    this.state = "paused";
    this.cancelTimer();
    this.abortInFlight();
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.state = "running";
    this.scheduleNext(this.opts.intervalMs);
  }

  isRunning(): boolean {
    return this.state === "running";
  }

  status(): PollLoopStatus {
    return {
      healthy: this.consecutiveFailures < this.opts.unhealthyAfter,
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessAt: this.lastSuccessAt,
    };
  }

  private scheduleNext(delay: number): void {
    if (this.state !== "running") return;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      void this.run();
    }, delay);
  }

  private async run(): Promise<void> {
    if (this.state !== "running") return;
    const aborter = new AbortController();
    this.aborter = aborter;
    try {
      await this.opts.tick(aborter.signal);
      this.backoffMs = 0;
      this.consecutiveFailures = 0;
      this.lastSuccessAt = Date.now();
      this.notifyIfStatusChanged();
      this.scheduleNext(this.opts.intervalMs);
    } catch (err) {
      // AbortError from a stop() / pause() — don't backoff, don't log,
      // don't count against health.
      if (
        aborter.signal.aborted ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }
      this.opts.onError(err);
      this.consecutiveFailures += 1;
      this.notifyIfStatusChanged();
      this.backoffMs = nextBackoff(this.backoffMs, this.opts);
      // RateLimitedError carries the server-supplied Retry-After floor.
      // The actual delay is max(exponential backoff, server hint) so we
      // never poll faster than the server explicitly asked.
      const retryAfterMs = retryAfterFloorMs(err);
      this.scheduleNext(Math.max(this.backoffMs, retryAfterMs));
    } finally {
      if (this.aborter === aborter) this.aborter = null;
    }
  }

  private notifyIfStatusChanged(): void {
    const isHealthy = this.consecutiveFailures < this.opts.unhealthyAfter;
    if (isHealthy !== this.wasHealthy) {
      this.wasHealthy = isHealthy;
      this.opts.onStatusChange(this.status());
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private abortInFlight(): void {
    if (this.aborter !== null) {
      this.aborter.abort();
      this.aborter = null;
    }
  }
}

export function nextBackoff(
  current: number,
  opts: Pick<PollLoopOptions, "intervalMs" | "maxBackoffMs">,
): number {
  const base = current === 0 ? opts.intervalMs : current * 2;
  const cap = opts.maxBackoffMs ?? 30_000;
  return Math.min(base, cap);
}

/**
 * If the error is a RateLimitedError (or any object that quacks like one
 * with a numeric retryAfterSeconds), return the floor in ms. Otherwise 0.
 * Pulled out as a free function so we don't have to import the error
 * class type — keeps poll-loop importable without viewer-fetch.
 */
function retryAfterFloorMs(err: unknown): number {
  if (err && typeof err === "object" && "retryAfterSeconds" in err) {
    const s = (err as { retryAfterSeconds: unknown }).retryAfterSeconds;
    if (typeof s === "number" && Number.isFinite(s) && s > 0) {
      return Math.ceil(s * 1000);
    }
  }
  return 0;
}

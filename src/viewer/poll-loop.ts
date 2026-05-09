// Polling scheduler for the viewer. Pure scheduling logic — no fetch,
// no DOM beyond the optional Page Visibility wiring (which is opt-in).
//
// Contract:
// - `start()` schedules ticks every `intervalMs` ms.
// - Each tick gets an `AbortSignal` so in-flight fetches cancel on stop.
// - On a thrown tick, the next tick is delayed via exponential backoff
//   (capped at `maxBackoffMs`). Successful tick resets the backoff.
// - `pause()` / `resume()` are idempotent. While paused, the interval is
//   cleared; resuming re-arms it without firing immediately.
// - `stop()` aborts the current tick and prevents further scheduling.

export interface PollLoopOptions {
  /** Tick fn. Reject/throw → backoff. */
  tick: (signal: AbortSignal) => Promise<void>;
  /** Base poll interval. M2 target: 1000. */
  intervalMs: number;
  /** Cap on exponential-backoff delay between failing ticks. */
  maxBackoffMs?: number;
  /** Called when a tick throws. Default: console.warn. */
  onError?: (err: unknown) => void;
}

export class PollLoop {
  private readonly opts: Required<Omit<PollLoopOptions, "onError">> & {
    onError: (err: unknown) => void;
  };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private aborter: AbortController | null = null;
  private state: "stopped" | "running" | "paused" = "stopped";
  private backoffMs = 0;

  constructor(opts: PollLoopOptions) {
    this.opts = {
      tick: opts.tick,
      intervalMs: opts.intervalMs,
      maxBackoffMs: opts.maxBackoffMs ?? 30_000,
      onError: opts.onError ?? ((err) => console.warn("poll-loop tick", err)),
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
      this.scheduleNext(this.opts.intervalMs);
    } catch (err) {
      // AbortError from a stop() / pause() — don't backoff, don't log.
      if (
        aborter.signal.aborted ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }
      this.opts.onError(err);
      this.backoffMs = nextBackoff(this.backoffMs, this.opts);
      this.scheduleNext(this.backoffMs);
    } finally {
      if (this.aborter === aborter) this.aborter = null;
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

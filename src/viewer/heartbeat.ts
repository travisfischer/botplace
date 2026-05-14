// Periodic "I'm watching" beacon to `/api/v1/public/sectors/:id/heartbeat`.
//
// One beacon every BEACON_INTERVAL_MS while the tab is visible — that's
// what populates the rolling-window viewer counter served by GET
// /viewers. The window on the server is ~2 minutes, so an interval at
// or under 60s keeps the viewer continuously present.
//
// Pause/resume mirrors the PollLoop's visibilitychange handling: a
// hidden tab stops beaconing and resumes with an immediate beacon when
// shown again. That avoids ghost viewers from background tabs while
// still recovering instantly on tab focus.

const BEACON_INTERVAL_MS = 60_000;

export interface HeartbeatOpts {
  /** Override the fetch impl in tests. */
  fetchImpl?: typeof fetch;
  /** Override the interval in tests. */
  intervalMs?: number;
  /** Optional base URL prefix (defaults to "" — same origin). */
  baseUrl?: string;
}

export interface HeartbeatHandle {
  start(): void;
  stop(): void;
}

/**
 * Returns a controller with `start()` / `stop()` that beacons once
 * immediately on start and then every `intervalMs` (default 60s).
 *
 * Failures are swallowed — the beacon is best-effort telemetry, never
 * a hard dependency of the viewer.
 */
export function createHeartbeat(
  sectorId: string,
  opts: HeartbeatOpts = {},
): HeartbeatHandle {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const intervalMs = opts.intervalMs ?? BEACON_INTERVAL_MS;
  const baseUrl = opts.baseUrl ?? "";
  let timer: ReturnType<typeof setInterval> | null = null;
  let aborter: AbortController | null = null;

  const beacon = () => {
    aborter?.abort();
    aborter = new AbortController();
    void fetchImpl(`${baseUrl}/api/v1/public/sectors/${sectorId}/heartbeat`, {
      method: "POST",
      // No body — server only needs the request itself + the client IP
      // it derives from the request envelope.
      credentials: "omit",
      // `keepalive: true` lets a beacon issued during pagehide / unload
      // survive long enough to complete. Harmless for the steady-state
      // foreground case.
      keepalive: true,
      signal: aborter.signal,
    }).catch(() => {
      // Best-effort.
    });
  };

  return {
    start() {
      if (timer !== null) return;
      beacon();
      timer = setInterval(beacon, intervalMs);
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      aborter?.abort();
      aborter = null;
    },
  };
}

# Probes

Manual operator-facing scripts that validate behaviors that aren't (yet) covered by automated tests, OR that need to be re-run against prod after a deploy. Each probe markdown describes one specific thing to validate, the steps, and the expected output.

The point isn't comprehensive coverage — that's `pnpm test`'s job. It's giving the next operator (human or coding agent) a self-contained recipe so they don't re-derive it from code under time pressure during an incident.

## Available probes

- [`replay.md`](replay.md) — confirms the `PixelEvent` log can reconstruct chunk state byte-for-byte. Backed by `pnpm test:api:replay`.
- [`redis-outage.md`](redis-outage.md) — confirms the rate limiter fails closed (503) when Upstash is unreachable.
- [`concurrency.md`](concurrency.md) — confirms `SELECT … FOR UPDATE` serializes concurrent writes to the same chunk.
- [`m2-viewer.md`](m2-viewer.md) — 8-probe matrix for the public viewer: 1s-tick timing, mobile touch (iOS Safari + Android Chrome), CDN ETag round-trip, cold-start TTFB, Vercel Firewall rate-limit, empty-canvas first paint. Merge gate for any change under `src/viewer/` or `app/api/v1/public/...`.
- [`m2.5-launch-bots.md`](m2.5-launch-bots.md) — 7-phase deployment + verification recipe for the M2.5 launch bots: schema migration, bot provisioning, Vercel env wiring, cron manual-trigger, end-to-end canvas verification, log inspection, tier verification, and rollback. Operator-runs after PR #14 merges.
- [`snapshot.md`](snapshot.md) — 6-probe matrix for the public snapshot endpoint and the viewer's first-paint preload: wire format, empty-sector header-only response, ETag 304 round-trip, network waterfall shape, CDN edge cache hit-rate, write-to-paint freshness. Merge gate for any change to `/api/v1/public/sectors/:id/snapshot` or the viewer's snapshot preload path.

## When to add a probe

When a behavior is hard to reason about from code alone OR when the validation procedure has a non-obvious sequence (precondition → action → assertion), a probe markdown is the right place to capture it. If it's just `pnpm test`, that's not a probe.

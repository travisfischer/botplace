# Probes

Manual operator-facing scripts that validate behaviors that aren't (yet) covered by automated tests, OR that need to be re-run against prod after a deploy. Each probe markdown describes one specific thing to validate, the steps, and the expected output.

The point isn't comprehensive coverage — that's `pnpm test`'s job. It's giving the next operator (human or coding agent) a self-contained recipe so they don't re-derive it from code under time pressure during an incident.

## Available probes

- [`replay.md`](replay.md) — confirms the `PixelEvent` log can reconstruct chunk state byte-for-byte. Backed by `pnpm test:api:replay`.
- [`redis-outage.md`](redis-outage.md) — confirms the rate limiter fails closed (503) when Upstash is unreachable.
- [`concurrency.md`](concurrency.md) — confirms `SELECT … FOR UPDATE` serializes concurrent writes to the same chunk.
- [`m2-viewer.md`](m2-viewer.md) — 8-probe matrix for the public viewer: 1s-tick timing, mobile touch (iOS Safari + Android Chrome), CDN ETag round-trip, cold-start TTFB, Vercel Firewall rate-limit, empty-canvas first paint. Merge gate for any change under `src/viewer/` or `app/api/v1/public/...`.
- [`snapshot.md`](snapshot.md) — 6-probe matrix for the public snapshot endpoint and the viewer's first-paint preload: wire format, empty-sector header-only response, ETag 304 round-trip, network waterfall shape, CDN edge cache hit-rate, write-to-paint freshness. Merge gate for any change to `/api/v1/public/sectors/:id/snapshot` or the viewer's snapshot preload path.
- [`m3-bot-dx.md`](m3-bot-dx.md) — 15-probe matrix for the M3 Bot DX milestone: handle migration, three new attribution endpoints (single-pixel, bots roster, bot-events), `/events` rename, click-to-inspect, hosted docs at `/build/*`, `/agents.md` aggregator, palette page deep-link anchors, audit-actor-kind backfill, M25 launch-bot regression, and the LLM-agent end-to-end exit signal. Merge gate for the M3 PR; pre-merge subset is probes 1–12, post-deploy subset is probes 13–15.
- [`admin-sector-reset.md`](admin-sector-reset.md) — operator runbook for the destructive sector reset CLIs (`admin:reset-sector-pixels` / `admin:reset-sector-messages`): admin-account grant, dev rehearsal + pass criteria, and the production rollout (Pattern 2 env sourcing, low-traffic window, resumability, `VACUUM`).

## When to add a probe

When a behavior is hard to reason about from code alone OR when the validation procedure has a non-obvious sequence (precondition → action → assertion), a probe markdown is the right place to capture it. If it's just `pnpm test`, that's not a probe.

---
date: 2026-05-09
topic: m2-public-viewer
status: draft
---

# Brainstorm: M2 — Public Canvas Viewer

## Status (as of 2026-05-09)

Draft. M1 (bot registration + pixel API + event log) shipped on 2026-05-09 and is verified end-to-end in production at <https://botplace.app>. Bots can write pixels and read them back through the authenticated API. **Humans cannot see the canvas yet.** This brainstorm scopes the smallest credible viewer that closes that gap, and gives the planning step (a requirement doc) enough material to lock decisions without redoing the option-comparison.

The MVP brainstorm ([2026-05-06](2026-05-06-mvp-scope-and-hosting.md)) committed in advance to:

- Chunked canvas state (already implemented; 100×100 chunks, 1 byte/pixel).
- Public sector snapshot/chunk reads.
- HTML canvas viewer with polling refresh.
- Basic sector navigation.
- **Defer** WebSockets, image diff frames, visible bot attribution, and pixel-ownership UI.

This doc deepens the "how" for those bullets and surfaces the new questions M1's implementation raised.

## Problem / Opportunity

The product premise — "AI bots paint a shared canvas" — is currently invisible. A human visiting <https://botplace.app> sees a sign-in page and nothing else. There's no way to:

- See the current canvas state.
- Watch bots write pixels in (near-)realtime.
- Share a URL that demonstrates the project to non-technical observers.
- Notice when something is wrong (canvas empty, all-one-color, frozen).

M2 makes the canvas *visible*. That unlocks public demos, qualitative feedback, and the pull on M3 (bot DX) — once people can see what bots do, they want to write bots.

The non-goals are equally important: M2 is **viewer**, not **interaction**. Humans don't paint pixels. Humans don't comment, react, follow bots, or own pixels. All of that lives in later milestones.

## What We're Building

### Scoped In

- **Public read endpoints (no auth).** Anonymous GETs for sector metadata, manifest of chunk versions, individual chunk binary, and single-pixel reads. Separate URL prefix from the authenticated API surface.
- **Public-read rate limit bucket.** Per-IP token bucket on the public endpoints, sized for legitimate viewer traffic + CDN cache misses, fail-closed when Upstash is unreachable (matches M1 posture).
- **Per-sector viewer page.** App Router route `app/sectors/[id]/page.tsx`. Server component fetches metadata; client component owns the canvas + polling loop. Root `/` shows the canvas (probably redirects or directly renders `sector-1` for now).
- **Canvas-2D renderer.** Fixed-size sector painted into a single `<canvas>` element using `ImageData` + `putImageData`. Scale via CSS / `image-rendering: pixelated` for crisp upscaling.
- **Pan + zoom UX.** Mouse-drag pan, wheel zoom, pinch zoom on touch. 1000×1000 doesn't fit comfortably on most screens at 1:1 even, so we need at minimum a "fit to viewport" default and a way to inspect at 1:1.
- **Polling loop with version-aware diff.** Client fetches a cheap manifest (chunk versions), compares against locally-known versions, GETs only changed chunks. Default cadence ~2s.
- **CDN-friendly cache headers.** `Cache-Control: public, s-maxage=<short>, stale-while-revalidate=<longer>` on public read endpoints so Vercel's edge absorbs poll traffic. Short `s-maxage` (1–3s) keeps writes visible promptly without paying for an active purge.
- **Sector navigation primitives.** URL is `/sectors/<id>` with multi-sector ready. Only `sector-1` exists in M2; navigating elsewhere is a route concern, not a DB or API concern.
- **Empty / never-written state.** Manifest is honest about which chunks have ever been written; viewer renders unwritten chunks as the sector's `default_color` (palette index 0).
- **Smoke + integration tests.** Public endpoints exercised in CI (real DB), client-side version-diff logic covered by unit tests.
- **Public viewer documentation.** `docs/api/v1.md` gets a "Public read endpoints" section; viewer architecture lives in `docs/dev/viewer.md` (or similar).

### Scoped Out

These are deliberately deferred. Each one is cheaper to add later than to over-design now.

- **WebSockets / SSE realtime.** Polling is the M2 contract. Realtime is the explicit M5 question — we don't pre-build it.
- **Server-rendered PNG snapshots / CDN diff frames.** Defer until polling cost actually hurts (the M5 measurement).
- **Pixel attribution UI.** "Click a pixel to see who painted it" is valuable but is an M3+ feature once we have starter-bot DX. The data is in `PixelEvent`; the UI isn't.
- **Recent-events feed / activity panel.** Same reasoning as attribution — interesting, but a layer on top of M2, not part of it.
- **Human-painted pixels.** Human pixels are not on the M5 roadmap and probably never. The product is bot-native.
- **Authenticated viewer features ("your bots highlighted", "follow this bot").** Defer to M3+.
- **Multi-sector grid / sector picker UI.** One sector exists; the URL shape supports more, the UI can stay trivial.
- **Mobile-first polish.** Touch pan/zoom should work but layout polish (orientation, virtual-keyboard handling, etc.) is not the bar.
- **Internationalization, accessibility audit beyond contrast basics, themed UI.** Out of scope.
- **Per-bot rate-limit tuning UI.** Operator concern, lives elsewhere.

## Approaches Considered

### A) Reuse authenticated chunk endpoint, drop the auth requirement

Make the existing `GET /api/v1/sectors/:id/chunks/:cx/:cy` (and friends) auth-optional: if no `Authorization` header, treat as public, apply public-read rate limit by IP. One code path, no duplicate routes.

Pros:
- Single endpoint surface to maintain.
- No client confusion about which URL to use.
- Tests cover one path.

Cons:
- Conflates two contracts. Today an unauthenticated request returns a byte-identical 401 (a security property M1 explicitly preserved). Toggling that on per-route opt-in flags is exactly the kind of branching that produces auth bypass bugs.
- Read-rate-limit semantics differ: authenticated callers get the per-credential bucket; anonymous callers need a per-IP bucket. Coexisting them in one handler is messier than splitting.
- Operators can't easily disable public access (e.g. during incident response) without affecting bot reads.

### B) Separate public endpoints under `/api/v1/public/...`

New routes: `GET /api/v1/public/sectors/:id`, `…/manifest`, `…/chunks/:cx/:cy`, `…/pixels/:x/:y`. Anonymous-by-design. Existing authenticated endpoints stay unchanged.

Pros:
- Auth contract is explicit at the URL boundary. No "auth-optional" branching.
- Independent rate-limit bucket, headers, and CDN cache policy without affecting authenticated callers.
- Operators can disable the prefix as a unit without touching bot writes / reads.
- Mirrors the principle "agent-native by default, but humans get a viewer" — humans get their own surface.
- Future SSE/WebSocket public stream slots in next to it without polluting `/api/v1/sectors`.

Cons:
- Two endpoint families that return similar shapes. A bug fix to one needs to be made in both — small ongoing tax.
- Slightly more route plumbing.

### C) Server-rendered PNG snapshots only (no public chunk reads)

Generate periodic PNG snapshots of each sector and serve the static image. Viewer is `<img src="…">`, no JavaScript polling.

Pros:
- Minimal client code.
- CDN-trivial.
- Effectively zero per-viewer DB load.

Cons:
- Snapshot freshness becomes its own infra problem (when do we regenerate? incremental? on-write?).
- Loses pixel-level interactivity (hover coords, future inspect).
- Doesn't establish the data path the realtime upgrade (M5) will need anyway.
- Premature: we don't yet know polling is too expensive.

## Recommended Approach

**Approach B** — separate `/api/v1/public/...` family, polling viewer, Canvas-2D renderer with manifest-diffed updates. CDN edge cache absorbs the polling tail; the auth contract stays clean.

Rationale:

- The principle "boring stack, narrow integrations" argues for keeping authenticated and anonymous paths separate so each is one obvious thing.
- The principle "no backwards-compat shims for un-shipped features" argues we shouldn't entangle authenticated bot reads with viewer reads — neither has callers we'd be breaking.
- Polling + manifest-diff gives realtime *enough* feel (~2s lag) without any new infra dependency, and it's the prerequisite for the M5 realtime measurement (we can't measure polling cost if we never deploy polling).
- Canvas 2D `putImageData` is well-suited to a 1MB-per-frame paint at low frequencies; WebGL is the wrong complexity here.

## Proposed M2 Architecture

### Public API surface

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/v1/public/sectors/:id` | Sector metadata: dims, palette, chunk size, default color. JSON. |
| `GET` | `/api/v1/public/sectors/:id/manifest` | Array of `{chunk_x, chunk_y, version, updated_at}` for chunks that have ever been written. JSON. |
| `GET` | `/api/v1/public/sectors/:id/chunks/:cx/:cy` | 10000-byte packed body, `X-Chunk-Version` and `X-Chunk-Updated-At` headers. Honors `If-None-Match` against `chunk_version` ⇒ 304. |
| `GET` | `/api/v1/public/sectors/:id/pixels/:x/:y` | Single pixel: `{ color, chunk_version, updated_at }`. JSON. |

All four:
- No auth.
- Rate-limited per IP (public-read bucket, separate from M1's authenticated read bucket).
- CDN-cached with short `s-maxage` + `stale-while-revalidate`.
- Same error envelope shape as the rest of v1 (`{ error, message?, request_id }`).

### Public-read rate limit

- Bucket: `PUBLIC_READ` per IP. Capacity ~120, refill ~60/s (so a viewer doing ~30 chunk GETs in a burst still has headroom for the next 2s tick). Numbers are starting points to be validated against real usage.
- Headers: `X-RateLimit-Remaining-Public-Read` on every response.
- Fail-closed when Upstash is unreachable: 503 `{ error: "rate_limit_unavailable" }`. Same fail-closed posture as M1's authenticated buckets.
- Memory-only fallback in dev (matches `lib/rate-limit.ts` M1 convention — no Upstash dependency for local development).

### CDN caching

Vercel respects `Cache-Control` on App Router responses. Recommended starting point:

- Manifest endpoint: `Cache-Control: public, s-maxage=2, stale-while-revalidate=10`. The manifest is the lightweight "did anything change?" call; aggressive edge caching is cheap because clients re-hit it constantly.
- Chunk endpoint: `Cache-Control: public, s-maxage=2, stale-while-revalidate=30`. ETag = chunk version. The version is in the URL query? No — keep URL stable, ETag is the cache key validator.
- Sector metadata: `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`. Rarely changes.
- Single-pixel endpoint: `Cache-Control: public, s-maxage=1, stale-while-revalidate=5`. Niche; tighter window.

These are *starting points*. The implementation requirement should call out: validate the cadence against a real production poll for ~10 minutes, adjust `s-maxage` if writes are visibly stale longer than the design budget (≤5s).

### Client architecture

```
app/
  sectors/
    [id]/
      page.tsx          // server component: fetches sector metadata, renders shell
src/
  viewer/
    canvas.tsx          // client component: <canvas>, putImageData, scale/CSS
    poll-loop.ts        // RAF + setInterval-driven poll loop
    chunk-cache.ts      // local Map<key, {version, bytes}>; manifest diff logic
    pan-zoom.ts         // pointer + wheel + touch -> transform state
tests/
  viewer/
    chunk-cache.test.ts // unit: manifest diff produces correct GET set
    poll-loop.test.ts   // unit: backoff, abort, version handling
```

The page is server-rendered for SEO/share-ability (sector metadata + initial chunk URLs in the HTML). The actual canvas is hydrated client-side; it owns its own polling lifecycle and unmounts cleanly.

### Polling cadence + diff strategy

```
on mount:
  GET /sectors/:id                   -> dims, palette
  GET /sectors/:id/manifest          -> all chunk versions
  for each chunk in manifest:
    GET /chunks/:cx/:cy               -> populate local cache + paint
loop every 2s:
  GET /sectors/:id/manifest          -> compare versions
  for each chunk where remote.version > local.version:
    GET /chunks/:cx/:cy               -> repaint that chunk
  for each chunk in local but not in remote (rare): leave as-is
```

The manifest is small even when the canvas is full: 100 chunks × ~30 bytes/entry = ~3KB. With 10s SWR on the manifest, most polls are CDN hits. Chunks only re-fetch when something actually changed.

### Empty / never-written chunks

Two reasonable treatments:

1. **Manifest omits unwritten chunks.** Client paints those areas with `default_color`. Simpler manifest payload; client logic slightly more involved.
2. **Manifest includes all chunks with `version: 0` for unwritten.** Client logic uniform; manifest payload always 100 entries.

Recommend (1) for M2: the canvas starts mostly empty, manifest stays small. Switching to (2) later is non-breaking (clients ignoring `version: 0` work fine; clients treating `version: 0` as "default-fill" also work).

### Pan + zoom

Minimal, deterministic, non-library:

- `transform: translate(x,y) scale(z)` on a wrapper div around the canvas. Canvas pixel buffer stays 1:1 with the sector; CSS handles zoom.
- `image-rendering: pixelated` (or `crisp-edges`) so upscaling stays sharp.
- Mouse: drag-to-pan, wheel-to-zoom (anchor on cursor), `+`/`-` keys.
- Touch: one-finger pan, two-finger pinch zoom.
- Default view: "fit to viewport" with some padding, centered.

No third-party pan/zoom library — the math is small and we don't want a 50KB dependency for what's essentially three transform updates.

### URL structure

- `/` → renders the canvas for `sector-1` directly (no redirect — keeps the canonical URL clean).
- `/sectors/sector-1` → same view, canonical for multi-sector future.
- `/sectors/:id/?x=&y=&z=` → optional viewport query params for share-links to a specific zoom/position. Stretch.

Sign-in lives at `/api/auth/signin` (already wired) and "manage your bots" at `/bots` (already exists). Top nav on the viewer should include those.

### Observability

- Public endpoints get the same `request_id` + structured-log treatment as M1.
- Viewer page emits *no* client-side telemetry in M2. We're not building analytics; that comes after we know what to measure.
- Server-side log fields: `auth_type: "public"` to distinguish from M1's authenticated reads.

## Open Questions

These are the decisions the planning step needs to lock. Each has a recommended default; if planning closes on the default, that decision rolls forward — if it picks differently, the requirement doc captures the reason.

1. **Public access default.** Open to anyone, IP-rate-limited only?
   - Default: **yes, fully open.** Matches r/place's contract and the "public canvas" premise. If abuse appears, we add a CAPTCHA-gated read or per-IP caps later.
2. **Per-pixel attribution endpoint in M2 vs M3?**
   - Default: **defer to M3** (bot DX milestone). M2's job is rendering, not attribution. We *could* expose `GET /public/sectors/:id/pixels/:x/:y/event` returning the latest `PixelEvent` for the pixel, but it's not required for the viewer.
3. **Manifest format: omit unwritten or include with `version:0`?**
   - Default: **omit unwritten.** Smaller payload. Forward-compatible.
4. **CDN cache durations.**
   - Default: starting points above (`s-maxage` 2/2/60/1 for manifest/chunk/sector/pixel). Validate in prod, tune in the requirement.
5. **Polling cadence.**
   - Default: **2s manifest poll.** Adjustable with `?poll=N` query param for debugging only (not user-facing).
6. **Empty viewer at launch.** With M3 not shipped yet, the first deploy of M2 shows a blank canvas. Do we ship a starter-bot to seed any activity?
   - Default: **no seed art, no starter bot in M2.** Empty canvas is honest. The "canvas is empty, write a bot" call-to-action becomes part of the page copy. Seeding feels like cheating; let the canvas reflect reality.
7. **Should the viewer page be served from a Vercel Edge runtime (lower TTFB) or Node runtime (default)?**
   - Default: **Node runtime.** Server component pulls sector metadata via Prisma; Edge would force a refactor. Revisit only if TTFB hurts.
8. **Single-pixel public endpoint — keep or cut?**
   - Default: **cut from M2.** The viewer has the chunk; it can read pixels client-side without a roundtrip. Add the public endpoint later only if a third-party scraping use-case appears.
9. **Pan/zoom: mouse-only minimum, or include touch for v1?**
   - Default: **include touch.** A working phone view is cheap if planned in; bolt-on later is more work.
10. **Default zoom level on first load.**
    - Default: **fit-to-viewport with 5% padding, centered.** "1:1 actual pixels" is too small to be useful on first impression.
11. **Where does the viewer's public-read bucket cap live?**
    - Default: **`lib/rate-limit.ts` `PUBLIC_READ` constant** alongside the existing buckets. Revisit only if usage shows we need per-route tuning.
12. **Canonical URL — `/` or `/sectors/sector-1`?**
    - Default: **`/` shows the canvas**, `/sectors/sector-1` is the canonical bookmark form, both render the same component. "/sectors" without an id is a 404. The current root page (Google sign-in shell) moves to a `/me` or `/account` route; the homepage is the canvas.

## Clarifying Questions for the Operator

Things planning may want to confirm with Travis before locking the requirement:

- **A. Brand/visual treatment.** Is the M2 viewer styled "raw and minimal" (focus on the canvas), or do we land a starting visual identity (logo, header, footer) at the same time? Default assumption: **raw and minimal**, identity work later.
- **B. Sign-in CTA placement.** Should the viewer page push sign-in for would-be bot authors, or stay neutral? Default assumption: **a small "Build a bot" link in the header** that goes to the API docs + sign-in flow, no aggressive CTA.
- **C. Demo/seed expectation.** Do you want at least one bot drawing *something* visible by the time M2 is publicly announced (so first visitors don't see a blank canvas)? If yes, that's an M2-adjacent task (a "demo bot" you operate from your laptop, not a feature). Default assumption: **no demo bot in M2**, blank canvas is fine and honest.
- **D. Sharing / OG metadata.** Should the viewer page generate per-sector Open Graph images so links unfurl as canvas snapshots in social previews? Default assumption: **defer**; it's a "snapshot pipeline" precursor and belongs with M5's snapshot work.
- **E. Canvas size assumption.** M2's design assumes one 1000×1000 sector. Is that still the right size, or do we want to validate with a smaller sector first (e.g. 256×256)? Default assumption: **stay with 1000×1000** — schema and chunk sizing are already in place; downsizing is throwaway work.
- **F. Anti-abuse posture.** The first time this is publicly linked, someone will try to DDoS it. Are we comfortable shipping with rate limits + Vercel/Cloudflare default DDoS protection, or do we want WAF rules / Turnstile in front of the viewer? Default assumption: **start with rate limits + platform defaults**, add Turnstile only if we measure abuse.
- **G. Telemetry boundary.** Do we want server-side request volume / latency dashboards for the public endpoints by the end of M2, or is that part of M4 (operational hardening)? Default assumption: **basic structured logs in M2** (matches M1), Grafana-style dashboards are M4.

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Public-read traffic is higher than expected; Postgres becomes the bottleneck. | Medium | High — site degrades under viewing load. | CDN edge caching with short `s-maxage`. Manifest endpoint minimizes per-chunk traffic. Measure in the first 24h post-deploy and tune `s-maxage` upward if needed. |
| R2 | DDoS / scraping abuse on the public endpoints. | Medium | Medium — viewer offline, possible bandwidth bill. | Per-IP rate limits with Upstash; fail-closed if backend down (matches M1). Vercel platform DDoS protection. Escalation path: Cloudflare WAF / Turnstile if it actually happens. |
| R3 | Polling is visibly laggy (e.g. >5s for a write to appear) once live. | Low | Medium — undercuts the "watch bots paint" promise. | `s-maxage=2` on manifest + chunk; 2s client poll = ~3–4s worst case end-to-end. Realtime upgrade is the planned M5 escape hatch. |
| R4 | Chunk endpoint cache stampede on a hot pixel (e.g. one chunk getting written constantly). | Low | Low | `stale-while-revalidate` smooths out the origin hit pattern. ETag-based 304s reduce origin work. |
| R5 | Browser compat regressions on Canvas-2D `putImageData` for non-evergreen browsers. | Very Low | Low | Modern-browser-only is fine for M2. Don't build a polyfill layer; document the floor. |
| R6 | Pan/zoom UX on mobile feels broken (touch handling is a known minefield). | Medium | Low | Manual probe across iOS Safari + Android Chrome before merging. Acceptable to ship "panning works, zoom is awkward on mobile" with a flag and fix in a follow-up. |
| R7 | Empty canvas at launch makes the project look dead. | Medium | Medium (perception, not product). | Page copy: "no pixels yet — you write the first one." Link to API docs + sign-in. This is also why the operator question (C) matters. |
| R8 | The "public" API surface ossifies — once we have viewer clients in the wild, breaking changes get expensive. | Low | Medium | Version under `/api/v1/public/`. The viewer code is in-repo; no external clients exist yet. Treat it as breakable until M3+ external bots / third-party UIs appear. |
| R9 | `If-None-Match` / ETag interaction with Vercel's CDN is subtle (it can rewrite ETags or force revalidation). | Medium | Low | Test the 304 path explicitly in a probe before merging. If Vercel's behavior is hostile, fall back to `?v=<version>`-cache-busted URLs. |
| R10 | Server component on the viewer page calls Prisma → cold start hit on every fresh visit. | Medium | Low | Sector metadata is cacheable (`s-maxage=60`); the page can fetch via the public HTTP endpoint instead of direct Prisma if cold-start is bad. |

## Effort Estimate

Rough day-level breakdown for a single focused implementer (Travis + coding agents). Numbers are *credible time*, not *aspirational time*.

| Slice | Estimate | Notes |
|---|---|---|
| Public read endpoints (sector / manifest / chunk) + tests | 0.5 day | Mostly cribbing M1's authenticated handlers minus auth; manifest is a new query. |
| `PUBLIC_READ` rate-limit bucket + Upstash wiring | 0.25 day | One new bucket constant; reuses `lib/rate-limit.ts`. |
| CDN cache headers + `If-None-Match` / ETag handling | 0.25 day | Includes a probe to verify Vercel honors the ETag round-trip. |
| Viewer page route + server component scaffold | 0.25 day | App Router boilerplate; metadata fetch. |
| Canvas-2D renderer + paint logic | 0.5 day | `ImageData` per chunk, CSS scaling. |
| Polling loop + manifest-diff cache | 0.5 day | Includes abort / cleanup on unmount, exponential backoff on errors. |
| Pan + zoom (mouse + touch) | 1.0 day | The unknown-unknown bucket. Touch always takes longer than expected. |
| Tests: viewer cache logic, public endpoint integration | 0.5 day | Vitest with real DB for endpoint tests; pure unit for cache diff. |
| Documentation: `docs/api/v1.md` public section + `docs/dev/viewer.md` | 0.25 day | Mirrors M1's doc pattern. |
| Manual probes: cross-browser, mobile, CDN behavior | 0.5 day | Not optional — UI changes need a real-browser pass. |
| Buffer / unknown unknowns | 0.5 day | Always. |

**Total: ~5 days of focused work.** Compare to M1, which was scoped at ~10 days and shipped close to it. M2 is genuinely smaller in surface area but the UX bits (pan/zoom, mobile) are where the schedule actually lives.

## Key Decisions (Recommended Defaults)

If planning adopts every default in this doc, the M2 requirement crystalizes around:

- **Approach B**: separate `/api/v1/public/...` endpoint family.
- **Polling, not realtime.** Realtime is the M5 question.
- **Canvas 2D + CSS-driven pan/zoom.** No WebGL, no third-party libraries.
- **CDN caching with short `s-maxage`** as the primary scaling lever.
- **Open access**, IP-rate-limited.
- **Empty-canvas-is-fine** at launch; no demo bot.
- **Defer attribution UI, recent-events feed, and OG snapshot generation.**
- **Multi-sector ready by URL shape; only `sector-1` ships.**

## Next Steps

1. Travis reviews this brainstorm and answers the **Clarifying Questions for the Operator** (A–G). Adopt defaults inline if they're correct; flip them in writing if not.
2. Convert this brainstorm into a requirement doc at `plans/requirements/requirement-<YYYYMMDD>-<HHMM>-milestone-2-public-viewer.md`. The requirement should:
   - Lock the open-question defaults (or whatever the answers were).
   - Specify the exact endpoint shapes and headers.
   - Specify the Vitest tests for public endpoints + viewer cache.
   - Specify the manual probes (CDN behavior, touch on iOS/Android, empty-canvas first paint).
   - Set exit criteria mirroring the MVP brainstorm: "pixel writes appear in the public viewer; viewer can load a full 1000×1000 sector without per-pixel queries; state can be rebuilt from event log."
3. Implement against the requirement.
4. Production verify: write a pixel as a bot, see it in the viewer within ~5s, share the URL.
5. Mark the MVP-brainstorm M2 entry as shipped; flip this doc's status to `adopted`.

---
date: 2026-05-09
topic: m2-public-viewer
status: in-progress
---

# Brainstorm: M2 — Public Canvas Viewer

## Status (as of 2026-05-09, post-Q&A)

In-progress. The first draft of this brainstorm was written 2026-05-09 morning; Travis answered the open questions and clarifying questions in the afternoon. This revision folds his answers in, splits decisions into **Resolved** vs **Still Open**, and reshapes the architecture around two new constraints he locked:

1. **End-to-end ~1-second update tick.** "Pixels show up roughly 1 second after they were written, anywhere on the canvas." This is now a hard target, not a default.
2. **Mobile parity.** The mobile read view is a first-class experience, not a "include touch" afterthought. Cross-device polish is part of the M2 bar.

Plus one posture change:

3. **No app-level rate limits on public reads.** Lean on Vercel + Cloudflare anti-abuse defaults; reserve app-level limits for cases we can't push to the edge.

The next deliverable is the M2 requirement doc, drafted alongside this revision at [`plans/requirements/requirement-20260509-1711-milestone-2-public-viewer.md`](../requirements/requirement-20260509-1711-milestone-2-public-viewer.md).

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

- **Public read endpoints (no auth).** Anonymous GETs for sector metadata, manifest of chunk versions, and individual chunk binary. Separate URL prefix from the authenticated API surface (`/api/v1/public/...`).
- **Per-sector viewer page.** App Router route `app/sectors/[id]/page.tsx`. Server component fetches metadata; client component owns the canvas + polling loop.
- **Canvas-2D renderer.** Fixed-size sector painted into a single `<canvas>` element using `ImageData` + `putImageData`. Scale via CSS / `image-rendering: pixelated` for crisp upscaling.
- **Pan + zoom UX, mobile-first.** Mouse-drag pan, wheel zoom, pinch zoom, one-finger pan on touch. Mobile parity is a hard bar (see Resolved §M).
- **1-second polling loop with version-aware diff.** Client hits the manifest every ~1s, compares against locally-known chunk versions, GETs only the chunks that changed. End-to-end target: ≤2s from `accepted_at` to visible-on-screen.
- **CDN edge caching as the primary scaling lever.** Cache manifest and chunk responses for ~1s on Vercel's edge so origin sees one query per region per second regardless of viewer count.
- **Sector navigation primitives.** URL is `/sectors/<id>` with multi-sector ready. Only `sector-1` exists in M2.
- **Empty / never-written state.** Viewer renders unwritten pixels as the sector's `default_color` (palette index 0).
- **Smoke + integration tests.** Public endpoints exercised in CI (real DB), client-side version-diff logic covered by unit tests.
- **Public viewer documentation.** `docs/api/v1.md` gets a "Public read endpoints" section; viewer architecture lives in `docs/dev/viewer.md`.
- **Cross-device manual probe.** Real iPhone + real Android + Chrome/Safari/Firefox desktop pass before merge.

### Scoped Out

These are deliberately deferred. Each one is cheaper to add later than to over-design now.

- **WebSockets / SSE realtime.** Polling is the M2 contract. If the 1s-tick target is reliably hit with polling, realtime is a strict M5 question. If polling falls short, see Risk R3 — we may pull SSE forward, but only on evidence.
- **Server-rendered PNG snapshots / CDN diff frames.** Defer until polling cost actually hurts (the M5 measurement).
- **Pixel attribution UI.** "Click a pixel to see who painted it" is M3+ once we have starter-bot DX. The data is in `PixelEvent`; the UI isn't.
- **Single-pixel public endpoint** (`/public/sectors/:id/pixels/:x/:y`). Original purpose was attribution-style lookups, which are M3+. Bots that want to read a single pixel use the authenticated endpoint. **Cut from M2.**
- **Recent-events feed / activity panel.** Same reasoning as attribution — interesting, but a layer on top of M2.
- **Human-painted pixels.** Out of scope forever-ish; the product is bot-native.
- **Authenticated viewer features ("your bots highlighted", "follow this bot").** Defer to M3+.
- **Multi-sector grid / sector picker UI.** One sector exists; the URL shape supports more, the UI can stay trivial.
- **Brand / visual identity polish.** Raw and minimal in M2; identity work is a separate stream.
- **Per-bot rate-limit tuning UI.** Operator concern, lives elsewhere.
- **App-level public-read rate limit bucket.** See §Resolved-K. Anti-abuse leans on Vercel + Cloudflare defaults; we don't ship `lib/rate-limit.ts` extensions for public reads in M2.
- **Open Graph / per-sector preview images for social unfurls.** Cool, deferred.
- **Demo bots seeded for launch.** Travis will spin those up post-M2 as an "M2.5" effort to make the canvas visibly active. Not part of this milestone.

## Resolved Decisions (2026-05-09)

These are locked. The requirement doc carries them forward verbatim.

- **A — Approach.** Separate `/api/v1/public/...` endpoint family, polling + manifest-diff, Canvas-2D + CSS pan/zoom. (Default approach was already the recommendation; Travis didn't push back.)
- **B — Public access.** Read access is fully open, no auth. Matches r/place's contract.
- **C — Per-pixel attribution endpoint.** Defer to M3 alongside bot DX. Don't build any attribution surface in M2.
- **D — Empty canvas at launch is fine.** Unwritten pixels render as the sector's `default_color` (palette index 0). The canvas is honest about being empty. Travis will spin up demo bots post-M2 ("M2.5") to make the canvas visibly active for an announcement.
- **E — Single-pixel public endpoint.** Cut from M2. Its original use cases (attribution, third-party scrapers) don't apply yet; bots use the authenticated endpoint; viewers always have the chunk locally.
- **F — Canonical URL.** `/` renders the canvas for `sector-1`. `/sectors/sector-1` is the canonical bookmark form, both render the same component. The Google sign-in shell that currently lives at `/` moves to `/account` (or similar). `/sectors` without an id is a 404.
- **G — Default zoom level.** Fit-to-viewport with ~5% padding, centered. If that proves visually too small to be useful at 1000×1000 on a phone (likely), we either bump default zoom or constrain "fit" to a maximum scale-down. Implementation tunes by eye; not worth pre-committing to a number.
- **H — Polling cadence.** ~1s manifest poll. End-to-end target: ≤2s from server-side `accepted_at` to visible-on-screen for a typical viewer.
- **I — Attribution data is captured, just not surfaced.** `PixelEvent` already records `bot_id` + `api_key_id` + timestamps. M3 reads it; M2 doesn't.
- **J — Brand / visual treatment.** Raw and minimal in M2. Identity work is a separate stream we'll do soon, but not blocking M2 ship.
- **K — Anti-abuse posture.** Lean on Vercel + Cloudflare anti-abuse defaults; do not ship app-level rate limits on public reads. The recommendation has a wrinkle (see §Still-Open-2) because our Cloudflare zone is currently in DNS-only mode per [`docs/dev/deploy.md`](../../docs/dev/deploy.md), so most Cloudflare protections aren't active. Vercel's automatic DDoS mitigation does run unconditionally. Belt-and-suspenders: keep the option to add a generous app-level cap if Vercel's protection isn't enough — but ship M2 without one and measure.
- **L — Telemetry.** Reuse Vercel + Cloudflare default observability. Server emits the same structured-log shape as M1 (`request_id` per request, `auth_type: "public"` on public-read log lines). No custom dashboards in M2; that's M4.
- **M — Mobile.** First-class. Touch pan, pinch zoom, and `image-rendering: pixelated` upscaling all need to feel right on iOS Safari and Android Chrome. Mobile is a merge bar, not a follow-up.
- **N — Sign-in CTA.** A small "Build a bot" link in the header that goes to API docs + sign-in. No aggressive CTA on the canvas itself.
- **O — OG / social preview images.** Defer.
- **P — Sector size.** Stay at 1000×1000. Don't downsize to 256² for testing — the schema and chunking are already there, M1 is in production with a 1000² sector, and the constraint forces real engineering rather than fake.

## Still Open

Four items remain. Each has a recommendation; the requirement doc adopts the recommendation by default unless Travis flips it during requirement review.

### 1. Manifest concept — what is it, and what does "unwritten" mean?

Travis asked for a clearer explanation of Q3. Here it is.

**The manifest** is a small JSON document the viewer fetches once per polling tick to figure out *which chunks need re-fetching*. The big win is that the actual chunk binaries are 10000 bytes each (100 chunks × 10000 bytes = 1MB if you fetch them all every tick); the manifest is a few KB and tells the client whether anything changed at all without paying for chunk bytes.

**Concretely** — the canvas is partitioned into `(sector_width / chunk_size) × (sector_height / chunk_size)` chunks. For `sector-1` that's 100 chunks (10×10 grid of 100×100 pixel tiles). Each chunk has a monotonic version that increments on every accepted write to it (M1 already implements this — `SectorChunk.version`).

So the manifest is essentially a snapshot of "for every chunk in this sector, what's its current version and `updated_at`?":

```json
[
  { "chunk_x": 0, "chunk_y": 0, "version": 17, "updated_at": "2026-05-09T17:11:12.345Z" },
  { "chunk_x": 0, "chunk_y": 1, "version": 3,  "updated_at": "..." },
  ...
]
```

Client logic per tick:
1. GET manifest.
2. For each entry, if `manifest[chunk].version > local_cache[chunk].version`, GET that chunk binary.
3. Repaint only the chunks that changed.

**"Unwritten" / "never-written"** means a `(sector_id, chunk_x, chunk_y)` triple that has no `SectorChunk` row yet. M1's storage is lazy-allocated — chunks are only INSERTed on first pixel write to them. So a fresh sector has zero rows. As bots write pixels, chunks materialize one by one.

The two manifest formats:

- **Option A — Omit unwritten chunks.** Manifest only lists chunks that have been written. Smaller payload (could be 0 entries in a fresh sector, up to 100 entries in a fully-touched one). Client interprets "chunk not in manifest" as "all pixels are `default_color` / palette index 0."
- **Option B — Always list all 100 chunks.** Unwritten chunks appear with `version: 0` and `updated_at: null`. Manifest is always 100 entries × ~50 bytes = ~5KB.

**Recommendation: Option A (omit unwritten).** Smaller payload (especially while the canvas is sparse), and a non-breaking change later if we need uniformity. Both options are equivalent in correctness; Option A wins on bytes-per-tick, which matters for the 1s-tick target.

### 2. Anti-abuse defaults — which Vercel + Cloudflare features are actually on?

Travis asked: "between Cloudflare … and Vercel, are there sane anti-abuse defaults we can turn on?"

**Current state** (from [`docs/dev/deploy.md`](../../docs/dev/deploy.md)):

- Cloudflare zone: `botplace.app`, **DNS-only** (grey cloud). The deploy doc explicitly notes that orange-cloud / proxied mode breaks Vercel's edge TLS, so we're on the unproxied path. This means Cloudflare's DDoS, WAF, bot fight mode, and rate-limiting features are *not active* — those require proxied traffic.
- Vercel: automatic platform-level DDoS protection runs on all plans. Vercel Firewall offers free-tier custom rules and basic bot management without changing DNS posture.

**Recommendation for M2:**

- Rely on Vercel's automatic DDoS protection (always on, no action required).
- Turn on **Vercel Firewall → "Attack Challenge Mode" toggle** as a kill switch we can flip during an active incident. Free tier supports this; it presents an interstitial challenge to suspicious traffic.
- Add **Vercel Firewall rules** for the `/api/v1/public/*` path:
  - Block requests with no `User-Agent` header (cheap bot filter).
  - Rate-limit to a generous ceiling (e.g. 600 req/min/IP) — high enough that legitimate viewers never hit it but flat-out scrapers do. This *replaces* any in-app rate limit; it lives at the edge so origin never sees the request.
- **Don't** flip Cloudflare to proxied mode in M2. That's a bigger refactor (TLS, DNS records, deploy.md updates) and we should make that change deliberately, not as part of M2.
- **Don't** ship Cloudflare Turnstile or any captcha in M2. Add only if real abuse appears.

If Vercel's free-tier firewall rules don't have IP-based rate limiting (this varies; needs verification during implementation), the fallback is a single in-app `PUBLIC_READ` bucket sized very generously (e.g. 60/sec/IP = 3600/min) — enough headroom that no real viewer hits it but a determined scraper does.

**Decision needed in implementation:** the requirement doc should call out "verify Vercel Firewall free-tier rate-limit rule capability before merging; if absent, add belt-and-suspenders in-app limit at 60/sec/IP."

### 3. CDN cache durations under the 1s-tick target

The original draft proposed `s-maxage=2` on manifest and chunk endpoints. With the 1s-tick target locked, that's too loose: a viewer could see a 2-second-old manifest, then poll 1 second later, and only see the new state ~3 seconds after the write. End-to-end budget would blow past 2s.

**Recommendation:**

| Endpoint | `s-maxage` | `stale-while-revalidate` | Rationale |
|---|---|---|---|
| `/public/sectors/:id/manifest` | 1s | 5s | Hot path. CDN absorbs 99% of viewer ticks; origin sees ~1 query/region/sec. |
| `/public/sectors/:id/chunks/:cx/:cy` | 1s | 30s | ETag = `chunk_version`. Most repeat fetches return 304 even when cache is warm. |
| `/public/sectors/:id` | 60s | 300s | Sector metadata barely changes. |

End-to-end budget under this config: write commits at T=0, manifest CDN can be up to 1s stale (viewer sees up to T=1), client polls at T=1 (worst case +1s offset = T=2), chunk fetch happens immediately. **Worst-case ~2s**, typical ~1.2s. Inside the 2s target.

Recommended *probe* in the requirement: spin up a local test bot that writes one pixel per second for 60 seconds, run a viewer in a second tab, and visually verify pixels show up within 2s consistently. If they don't, drop `s-maxage` to 0 on the manifest (origin-only) and retest.

### 4. Vercel runtime — Node vs Edge for public endpoints

Travis asked: "Can we reasonably design the system to serve this polling at a 1-second interval using this approach, or should we lean into a more performant design from the start?"

**The math:**

- Manifest endpoint, hottest path. With CDN `s-maxage=1`, origin sees ≤ 1 request per Vercel region per second per cache-invalidation cycle. For one sector with all-region traffic, that's a small bounded number of origin hits per second regardless of viewer count. That's fine on Node runtime + Prisma.
- Chunk endpoint, cold path most of the time (304s + cache hits). Origin hits when a chunk version actually changed in the last 1s window. Bounded by write rate, not read rate.
- Sector metadata, very cold. `s-maxage=60`.

**Recommendation: stick with Node runtime in M2.**

- M1's existing Prisma + adapter-pg setup is Node-runtime. Edge would force a switch to Neon's HTTP serverless driver, which is a separate integration to wire up.
- The CDN absorbs the polling load, so origin throughput isn't the bottleneck — origin *latency* is the budget item, and Node + Prisma + a single primary-key query is well within the 200ms-ish window we need.
- If the probe in §3 shows we're missing the 2s budget *because origin is slow* (not because cache invalidation is slow), revisit Edge then. Don't pre-build it.

**Implementation flag:** the requirement doc should include "verify origin response time for `/public/sectors/:id/manifest` is < 100ms p95 under realistic viewer load. If not, escalate to Edge runtime + Neon serverless driver as a follow-up before declaring M2 done."

## Approaches Considered

(Original framing preserved here for reference. Approach B — separate public endpoints — was selected and confirmed.)

### A) Reuse authenticated chunk endpoint, drop the auth requirement

Make the existing `GET /api/v1/sectors/:id/chunks/:cx/:cy` (and friends) auth-optional. Rejected: conflates auth contracts (M1's byte-identical 401 invariant), mixes per-credential and per-IP rate-limit semantics, and prevents disabling public access without affecting bot reads.

### B) Separate public endpoints under `/api/v1/public/...`

Selected. Auth contract is explicit at the URL boundary; independent CDN cache policy; future SSE stream slots in alongside.

### C) Server-rendered PNG snapshots only (no public chunk reads)

Rejected as premature. Doesn't establish the data path the eventual realtime upgrade needs anyway.

## Recommended Approach

**Approach B**, plus the constraints locked above:

- Polling at ~1s, manifest-diffed, Canvas-2D, CSS pan/zoom, mobile-parity.
- CDN edge cache (`s-maxage=1`) is the scaling lever.
- Anti-abuse via Vercel Firewall, not app-level rate limits.
- Node runtime; revisit Edge only on measured evidence.

## Proposed M2 Architecture

### Public API surface (final)

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/v1/public/sectors/:id` | Sector metadata: dims, palette, chunk size, default color. JSON. `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`. |
| `GET` | `/api/v1/public/sectors/:id/manifest` | Array of `{chunk_x, chunk_y, version, updated_at}` for chunks that have ever been written (Option A — see §Still-Open-1). JSON. `Cache-Control: public, s-maxage=1, stale-while-revalidate=5`. |
| `GET` | `/api/v1/public/sectors/:id/chunks/:cx/:cy` | 10000-byte packed body, `X-Chunk-Version` and `X-Chunk-Updated-At` headers. `ETag: "<chunk_version>"`. Honors `If-None-Match` ⇒ 304. `Cache-Control: public, s-maxage=1, stale-while-revalidate=30`. |

All three:
- No auth.
- No app-level rate limit (anti-abuse at the Vercel Firewall edge).
- Same error envelope as the rest of v1 (`{ error, message?, request_id }`).
- Structured server log line per origin hit, with `auth_type: "public"` and `request_id`.

### Client architecture

```
app/
  page.tsx            // server component: redirects to / renders sector-1 viewer
  sectors/
    [id]/
      page.tsx        // server component: fetches sector metadata, renders shell
  account/            // (relocated from current `/`)
    page.tsx          // sign-in / out shell
src/
  viewer/
    canvas.tsx        // client component: <canvas>, putImageData, pan/zoom transform
    poll-loop.ts      // 1s manifest poll, abort/cleanup
    chunk-cache.ts    // local Map<key, {version, bytes}>; manifest diff logic
    pan-zoom.ts       // pointer + wheel + touch -> transform state; mobile-parity
tests/
  viewer/
    chunk-cache.test.ts // unit: manifest diff produces correct GET set
    poll-loop.test.ts   // unit: backoff, abort, version handling
```

### Polling loop

```
on mount:
  GET /sectors/:id                   -> dims, palette
  GET /sectors/:id/manifest          -> all written chunk versions
  for each chunk in manifest:
    GET /chunks/:cx/:cy               -> populate local cache + paint
loop every 1s (clock-aligned):
  GET /sectors/:id/manifest          -> compare versions; ETag from last response
  for each chunk where remote.version > local.version:
    GET /chunks/:cx/:cy               -> repaint that chunk
  if tab is hidden (Page Visibility API): pause loop until visible
```

End-to-end target ≤ 2s. Worst-case derivation in §Still-Open-3.

### Pan + zoom (mobile-first)

- `transform: translate(x,y) scale(z)` on a wrapper around the `<canvas>`. Canvas pixel buffer stays 1:1; CSS handles zoom.
- `image-rendering: pixelated` for crisp upscaling.
- **Desktop:** drag-to-pan, wheel-zoom anchored on cursor, `+`/`-` keys, double-click to zoom in.
- **Mobile:** one-finger pan, two-finger pinch (anchored on midpoint), double-tap to zoom in, two-finger tap to zoom out. Disable browser default touch scroll on the canvas element via `touch-action: none`.
- Default view: fit-to-viewport with 5% padding, centered. If that's too small to read on phone screens at 1000×1000, default to a higher zoom level whose actual value is tuned by eye.
- No third-party pan/zoom library.

### Empty / never-written chunks

Manifest omits unwritten chunks (Option A — §Still-Open-1). Viewer initializes the canvas to a fill of `default_color` once `sector` metadata arrives, then paints over it as chunks come in.

### Observability

- Per-request structured log line with `request_id`, `auth_type: "public"`, response time, status.
- No client-side telemetry in M2.
- M2 explicitly does not build dashboards; relies on Vercel + Cloudflare default views.

### Anti-abuse

- Vercel Firewall: free-tier rules on `/api/v1/public/*`. Expected ruleset:
  - Block missing `User-Agent`.
  - Rate-limit at edge: 600 req/min/IP if available; else fall back to in-app limit at 60/sec/IP as documented in §Still-Open-2.
  - "Attack Challenge Mode" toggle as kill switch.
- No Cloudflare WAF in M2 (we'd need to flip to proxied DNS, which is a separate decision).

## Effort Estimate

Updated for the new constraints (mobile-first, 1s-tick verification, anti-abuse research).

| Slice | Estimate | Notes |
|---|---|---|
| Public read endpoints (sector / manifest / chunk) + tests | 0.5 day | Cribs M1's authenticated handlers minus auth; manifest is the new query. |
| CDN cache headers + ETag/`If-None-Match` + 1s probe | 0.5 day | Includes verifying Vercel honors ETag round-trip end-to-end. |
| Vercel Firewall configuration + verification | 0.25 day | Configure rules; confirm `/public/*` is gated; document. |
| Viewer page route + server component scaffold | 0.25 day | App Router boilerplate, sector metadata fetch, relocate sign-in shell to `/account`. |
| Canvas-2D renderer + paint logic | 0.5 day | `ImageData` per chunk, CSS scaling. |
| Polling loop + manifest-diff cache + Page Visibility integration | 0.5 day | Includes abort/cleanup, exponential backoff on errors, pause on hidden tab. |
| Pan + zoom (mobile-first; desktop falls out for free) | 1.5 days | Mobile is the unknown-unknown bucket. iOS pinch-zoom + two-finger gestures always cost more than expected. |
| Tests: viewer cache logic, public endpoint integration | 0.5 day | Vitest with real DB for endpoint tests; pure unit for cache diff. |
| Documentation: `docs/api/v1.md` public section + `docs/dev/viewer.md` | 0.25 day | Mirrors M1's doc pattern. |
| Manual probes: cross-browser, real-iPhone + real-Android, 1s-tick e2e timing, CDN behavior | 0.75 day | Not optional. Mobile parity is a merge bar. |
| Buffer / unknown unknowns | 0.5 day | Always. |

**Total: ~5.5–6 days of focused work.** Up from 5d in the first draft. Mobile-first + 1s-tick verification + anti-abuse setup adds roughly a day collectively.

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Public-read traffic exceeds origin capacity. | Medium | High | CDN edge cache (`s-maxage=1`) bounds origin to ~1 manifest query/region/sec. Probe origin p95 latency before declaring done. |
| R2 | DDoS / scraping abuse on public endpoints. | Medium | Medium | Vercel automatic DDoS + Vercel Firewall rules. Escalation path: flip Cloudflare to proxied mode (deferred decision). |
| R3 | 1s-tick target misses (>2s end-to-end). | Medium | Medium | Probe explicitly. If misses are due to cache TTL, drop manifest `s-maxage` to 0 (origin-only). If due to origin latency, escalate to Edge runtime / Neon serverless driver. If due to fundamental polling overhead, pull SSE forward from M5. |
| R4 | Mobile pan/zoom feels broken in real use. | Medium | High (Travis flagged mobile parity as a bar) | Real-device probe (iPhone + Android) before merge, not just emulator. Ship behind a flag if needed and follow-up; **do not declare M2 done with broken mobile**. |
| R5 | `If-None-Match` / ETag interaction with Vercel CDN is subtle. | Medium | Low | Test the 304 path explicitly in a probe. Fall back to `?v=<version>`-cache-busted URLs if Vercel's behavior is hostile. |
| R6 | Manifest payload grows unmanageable as canvas fills (Option A omits unwritten — caps at ~5KB even fully written). | Low | Low | Hard cap is 100 chunks × ~50 bytes = ~5KB for `sector-1`. Multi-sector world needs to revisit. |
| R7 | Empty canvas at launch makes the project look dead. | High (mitigated by Travis's M2.5 demo-bot plan) | Medium (perception) | Page copy: "no pixels yet — you write the first one." Travis spins up demo bots in M2.5 before any public announcement. |
| R8 | "Public" API surface ossifies. | Low | Medium | Versioned under `/api/v1/public/`. Treat as breakable until external clients exist. |
| R9 | Server component on viewer page calls Prisma → cold-start hit on every fresh visit. | Medium | Low | Use the public HTTP endpoint with its own CDN cache instead of Prisma directly inside the server component. |
| R10 | Vercel Firewall free-tier doesn't support per-IP rate limiting. | Medium | Low | Fall back to in-app `PUBLIC_READ` bucket at 60/sec/IP; document the verification step in the requirement. |
| R11 | Page Visibility API misses cause polling to keep running on backgrounded tabs, wasting Vercel function invocations. | Low | Low | Pause poll on `visibilitychange → hidden`, resume on `visible`. Standard pattern. |

## What Comes After M2 (Pre-M3 Note)

Travis flagged "M2.5: demo bots" as an explicit interstitial. Out of scope for the M2 milestone itself, but worth capturing here so it doesn't fall through:

- After M2 ships, before M3 starts in earnest, Travis stands up one or two demo bots that draw simple patterns on `sector-1`. These run from his laptop, not as a hosted feature.
- Purpose: make the canvas visibly active for any public link / announcement.
- This is operator-side work, not engineering work. The bots use the existing M1 API. Probably worth a short note in the project README and a public link.
- If at any point demo bots want to live in-repo as starter examples, they morph into M3 (bot DX).

## Next Steps

1. **Travis reviews this brainstorm rev** — confirm Resolved decisions still match what he said, flip any defaults in §Still Open if recommendations don't sit right.
2. **Open the M2 requirement doc.** Drafted alongside this revision at [`plans/requirements/requirement-20260509-1711-milestone-2-public-viewer.md`](../requirements/requirement-20260509-1711-milestone-2-public-viewer.md).
3. **Implement against the requirement.** ~5.5–6 days focused work.
4. **Production verify.** Bot writes pixel → viewer shows it within 2s on desktop and mobile. Share the URL.
5. **Mark this brainstorm `adopted`** and the MVP-brainstorm M2 entry as shipped.
6. **Spin up M2.5 demo bots** before any public announcement.

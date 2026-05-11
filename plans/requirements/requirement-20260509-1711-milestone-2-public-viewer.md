---
date: 2026-05-09
type: feature
topic: milestone-2-public-viewer
status: shipped
shipped: 2026-05-11
planning_depth: standard
---

# Requirement: Milestone 2 — Public Canvas Viewer

## Shipped vs deferred (2026-05-11)

**Shipped to <https://botplace.app>:**

- V1 — Three public read endpoints under `/api/v1/public/...` (sector metadata, manifest, chunk binary) with `Cache-Control` + `CDN-Cache-Control` headers and ETag/If-None-Match short-circuit on the chunk endpoint. The CDN absorbs steady-state polling; the `PUBLIC_READ` rate-limit bucket is the in-app floor below Vercel's Firewall.
- V2 — Viewer page at `/` and `/sectors/:id` (canonical bookmark form). Google sign-in shell relocated to `/account`. Server component fetches metadata via the shared `loadSectorMeta` helper in `src/sectors/` (no HTTP loopback, no SSRF surface).
- V3 — `ChunkCache`, `PollLoop`, `viewer-fetch` modules with 26 unit tests covering manifest-diff, Retry-After-aware exponential backoff, status-change callbacks, and cache repaint on (re)mount.
- V4 — Canvas-2D rendering with Uint32 RGBA palette + dirty-rect `putImageData`, CSS-driven pan/zoom, Pointer Events unifying mouse/touch/pen, two-pointer pinch math, keyboard navigation, `image-rendering: pixelated`, mobile parity verified on real iPhone Safari + Android Chrome.
- V5 — Vercel Firewall rules configured: `public-no-ua` (block requests with empty User-Agent) and `public-rate-limit` (600 req/min/IP). In-app `PUBLIC_READ` bucket (60/sec/IP) is the unconditional floor.
- V6 — Docs: public-endpoint section in [`docs/api/v1.md`](../../docs/api/v1.md), new [`docs/dev/viewer.md`](../../docs/dev/viewer.md), Firewall recipe in [`docs/admin/v1.md`](../../docs/admin/v1.md), `docs/dev/probes/m2-viewer.md` probe matrix, and the agent-runnable `pnpm sector:create-probe` / `pnpm dev:seed-bot` helpers.
- V7 — Manual probes 1, 5, 6, 7 verified from operator side; mobile probes 2 + 3 verified on real devices.
- Bot-side parity (P2.10): authenticated `/api/v1/sectors/:id/manifest` + ETag on the existing chunk endpoint so bots can mirror sectors without going through the human door.

**Deferred (not blocking M2; tracked for follow-up):**

- M2.5 demo bots — small operator-side bots writing recognizable patterns to `sector-1`, so first visitors see movement instead of an empty canvas. Travis-side follow-up before any public announcement.
- Firewall-rules-as-code — currently configured via the Vercel dashboard. A `pnpm admin:firewall` script that PUTs the rules via Vercel's REST API would mirror the agent-native bar M1 set. Carried into M3 polish.
- Pixel attribution UI / click-to-inspect — the data is in `PixelEvent` rows; surfacing it in the viewer ships with M3 (bot DX).
- Probe-headless automation — the manual probe matrix is documented and labeled by headlessness, but the timing-sensitive probes (1, 6) still rely on visual / dashboard verification. Scripted assertion helpers would tighten the next milestone's verification loop.

**Carried into the M3 polish window** (review P3s): wire/protocol nits (X-Request-Id on success responses, RFC-7232-compliant If-None-Match parser, Vary header), code organization nits, doc consolidation. None gate M2 ship.

## Status

**Draft, ready for implementation.** Authored 2026-05-09 from the [M2 brainstorm](../brainstorms/2026-05-09-m2-public-viewer.md) after Travis's Q&A pass; all decisions confirmed on the second pass. Implementation Decisions IM-1 through IM-4 are now locked, not pending review.

> **Origin.** This requirement converts the [M2 brainstorm](../brainstorms/2026-05-09-m2-public-viewer.md) into actionable scope. The MVP brainstorm ([2026-05-06](../brainstorms/2026-05-06-mvp-scope-and-hosting.md)) committed Botplace to "humans can watch bot activity on a real canvas" as Milestone 2; this is the executable shape of that commitment.

## Problem / Outcome

M1 ships an authenticated bot API that successfully writes pixels to `sector-1` and reads them back. **Humans cannot see the canvas yet.** A visitor to <https://botplace.app> sees a Google sign-in shell and nothing else. There is no way to demo the project, no way to share a URL that demonstrates "AI bots paint a shared canvas," and no operator-side visibility into whether the canvas is doing anything at all.

The M2 outcome is a publicly-reachable, anonymous-readable canvas viewer that:

- Lives at <https://botplace.app/> (root) and <https://botplace.app/sectors/sector-1/> (canonical bookmark form).
- Renders the current state of `sector-1` to an HTML canvas.
- Shows pixel writes within ~2s of `accepted_at`, anywhere on the canvas, on any device.
- Works equally well on desktop and mobile (pan, zoom, pinch, fit-to-viewport).
- Imposes no app-level rate limits on public reads — anti-abuse runs at the Vercel Firewall edge.

The exit signal: a bot writes a pixel; a desktop viewer in one tab and an iPhone viewer in another both display it within 2 seconds; the URL can be shared on social media without authentication.

## Scope

### In Scope

#### V1 — Public read endpoints under `/api/v1/public/...`

Three new GET endpoints, no auth, anonymous-by-design. All three live in `app/api/v1/public/...` route handlers, share the same response envelope shape as the rest of v1, and emit structured server logs with `auth_type: "public"` and a `request_id`.

| Path | Returns | Cache-Control |
|---|---|---|
| `GET /api/v1/public/sectors/:id` | Sector metadata (dims, palette, chunk_size, default_color). Same JSON shape as the authenticated endpoint. | `public, s-maxage=60, stale-while-revalidate=300` |
| `GET /api/v1/public/sectors/:id/manifest` | JSON array of `{chunk_x, chunk_y, version, updated_at}` for chunks that have ever been written. **Omits** unwritten chunks (Option A — see §Implementation Decisions, IM-1). | `public, s-maxage=1, stale-while-revalidate=5` |
| `GET /api/v1/public/sectors/:id/chunks/:cx/:cy` | 10000-byte packed binary, `Content-Type: application/octet-stream`. Headers: `X-Chunk-Version`, `X-Chunk-Updated-At`, `ETag: "<chunk_version>"`. Honors `If-None-Match` ⇒ 304. | `public, s-maxage=1, stale-while-revalidate=30` |

Error envelope (`{ error, message?, request_id }`):

- `404 sector_not_found` — sector id doesn't exist.
- `404 chunk_not_found` — chunk coordinates out of range. (Never-written chunks within range are not 404 — see §IM-1.)
- `500 internal_error` — unexpected.

**Deliberately not included** (see also Out of Scope): no `/public/sectors/:id/pixels/:x/:y` endpoint. Single-pixel public reads are deferred to M3 alongside attribution UI.

Acceptance:
- All three endpoints return 200 against a real DB with `sector-1` populated.
- Cache headers match the table above.
- ETag on chunk responses uses the bigint chunk version (stringified), in quotes per RFC 7232.
- A request with `If-None-Match: "<current-version>"` returns 304 with no body.
- Structured log line per origin hit includes `request_id`, `auth_type: "public"`, `path`, `status`, `latency_ms`.
- An integration test in `tests/api/public-endpoints.test.ts` exercises all three endpoints, the 304 path, and the never-written-chunk case.

#### V2 — Viewer page + canvas component

App Router route at `app/sectors/[id]/page.tsx` (server component) that renders the public sector viewer. The current sign-in shell at `app/page.tsx` moves to `app/account/page.tsx`; root `/` renders the `sector-1` viewer.

File layout:

```
app/
  page.tsx                  // server component: renders <SectorViewer sectorId="sector-1" />
  sectors/
    [id]/
      page.tsx              // server component: fetches metadata, renders <SectorViewer sectorId={id} />
  account/
    page.tsx                // server component: relocated sign-in/out shell
src/
  viewer/
    sector-viewer.tsx       // client component: wires canvas + polling + pan-zoom
    canvas.tsx              // client component: <canvas>, putImageData, transform
    poll-loop.ts            // pure: 1s tick scheduling, abort, error-backoff
    chunk-cache.ts          // pure: Map<key, {version, bytes}>; manifest diff
    pan-zoom.ts             // pure: pointer + wheel + touch -> transform state
```

The server component fetches sector metadata via the public HTTP endpoint (not Prisma directly — see Risk R9 / IM-4) and passes it as initial props to the client component. The client component owns the polling lifecycle, mounts/unmounts cleanly, and pauses on hidden tabs (Page Visibility API).

The viewer page header includes:
- A small "Build a bot" link that goes to the API docs + sign-in flow.
- An "Account" link visible only to signed-in users.

No other chrome, no logo work, no footer beyond copyright + repo link. Raw and minimal.

Acceptance:
- `/` renders the canvas viewer; `/sectors/sector-1` renders the same viewer.
- `/account` renders the relocated sign-in shell. `/sectors` (no id) returns 404.
- Server-side rendering produces a meaningful HTML shell with sector metadata embedded so first paint isn't blank.
- The viewer mounts and unmounts cleanly when navigating away (no orphaned poll timers).

#### V3 — Polling loop + manifest-diff cache

Client polls the manifest endpoint every 1 second (clock-aligned, not drift-prone). For every chunk where `manifest.version > local_cache.version`, fetch the chunk binary and repaint just that chunk.

Pseudocode (final):

```typescript
// poll-loop.ts (sketch)
async function tick() {
  if (document.hidden) return; // paused
  const manifest = await fetch(`/api/v1/public/sectors/${id}/manifest`).then(r => r.json());
  const stale = chunkCache.diff(manifest); // returns chunks where remote > local
  for (const { chunk_x, chunk_y, version } of stale) {
    const res = await fetch(
      `/api/v1/public/sectors/${id}/chunks/${chunk_x}/${chunk_y}`,
      { headers: chunkCache.has(chunk_x, chunk_y) ? { 'If-None-Match': `"${chunkCache.version(chunk_x, chunk_y)}"` } : {} },
    );
    if (res.status === 304) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    chunkCache.set(chunk_x, chunk_y, version, bytes);
    canvas.repaintChunk(chunk_x, chunk_y, bytes);
  }
}

setInterval(tick, 1000);                 // 1Hz
document.addEventListener('visibilitychange', /* pause/resume */);
```

Error handling:
- `429` from edge: respect `Retry-After`, double the poll interval until success.
- Network error: exponential backoff capped at 30s, log to console, no toast / popup.
- `503 rate_limit_unavailable`: same backoff posture as 429.

Unit tests in `tests/viewer/`:
- `chunk-cache.test.ts`: manifest diff produces correct GET set; never-written-chunk handling; version-monotonic enforcement.
- `poll-loop.test.ts`: pauses on hidden tab; resumes on visible; backoff doubles on error; abort signal cancels in-flight requests.

Acceptance:
- Manifest poll runs at 1Hz when the tab is visible, pauses when hidden.
- Only changed chunks get re-fetched; chunks unchanged across ticks return 304.
- E2E timing target: pixel write → visible within 2s on desktop and mobile (validated under V7).

#### V4 — Pan + zoom (mobile-first)

`transform: translate(x, y) scale(z)` on a wrapper around the `<canvas>`. Canvas pixel buffer stays 1:1 with the sector (1000×1000 ImageData backing); CSS handles all zoom rendering with `image-rendering: pixelated`.

Required gestures:

| Surface | Pan | Zoom | Reset |
|---|---|---|---|
| Desktop mouse | drag | wheel (anchored on cursor) | double-click to fit |
| Desktop keys | arrow keys | `+` / `-` | `0` |
| Mobile touch | one-finger drag | two-finger pinch (anchored on midpoint) | double-tap to fit |

Constraints:
- `touch-action: none` on the canvas wrapper to disable browser default scroll-on-canvas behavior.
- Zoom levels clamped to `[0.1, 8]`. (At 0.1 the whole sector fits in 100px; at 8 each pixel is 8px.)
- Pan clamped so the canvas never fully exits the viewport.
- Default view on first load: fit-to-viewport with 5% padding. If that ends up too small to be useful on a phone (validated in V7), bump default to a higher zoom whose specific value is tuned by eye in implementation.

No third-party pan/zoom library. ~150 LOC of pointer/touch math max.

Acceptance:
- All gestures in the table above work on real iOS Safari and real Android Chrome.
- Pinch zoom feels smooth (no jank, no double-firing).
- Browser-default scroll-on-canvas is suppressed on mobile.
- Real-device probe in V7 gates the merge.

#### V5 — Anti-abuse / Vercel Firewall configuration

No app-level rate limit on `/api/v1/public/*`. Anti-abuse lives at the Vercel Firewall edge.

Configure (via the Vercel dashboard, since Vercel doesn't ship Firewall as code — document the setting in `docs/admin/v1.md` so it's reproducible):

- **Block requests with no `User-Agent` header** to `/api/v1/public/*`. Cheap bot filter.
- **Per-IP rate limit on `/api/v1/public/*`: 600 req/min/IP** if Vercel Firewall free tier supports it. Verify capability during implementation.
- **"Attack Challenge Mode" toggle** documented as the kill switch operators flip during an active incident.

If the per-IP rate-limit feature isn't on free tier, fall back to a single in-app `PUBLIC_READ` bucket sized at 60/sec/IP (= 3600/min/IP) using the existing `lib/rate-limit.ts` shape. Document the fallback choice inline.

Cloudflare anti-abuse stays off in M2: the zone is in DNS-only mode per [`docs/dev/deploy.md`](../../docs/dev/deploy.md), and flipping to proxied is a separate decision (TLS, deploy doc updates) we are not making in this milestone.

Acceptance:
- Vercel Firewall rules are configured + screenshotted into `docs/admin/v1.md` (or equivalent).
- A single `curl --user-agent ''` against `/api/v1/public/sectors/sector-1` returns a Vercel block response (or a 4xx if implemented at app fallback).
- A burst of >600 req/min from one IP gets rate-limited (verified via the probe in V7).
- The "Attack Challenge Mode" toggle path is documented.

#### V6 — Documentation

- **`docs/api/v1.md`**: new "Public read endpoints" section documenting `/api/v1/public/sectors/:id`, `/manifest`, `/chunks/:cx/:cy`. Include the polling-loop example as a cookbook recipe.
- **`docs/dev/viewer.md`** (new): viewer architecture — file layout, polling cadence, chunk cache, pan/zoom, mobile-first decisions, why no app-level rate limit.
- **`docs/admin/v1.md`**: append the Vercel Firewall configuration recipe (rules + Attack Challenge Mode toggle).
- **`docs/README.md`**: add the new viewer doc to the TOC.
- **`README.md`**: flip the M0+M1 line to "M0 + M1 + M2 live; M3 next" once M2 ships.

Acceptance: each doc exists, is reachable from `docs/README.md`, and has at least one copy-pasteable example.

#### V7 — Manual probes (merge-blocking)

These are not optional. Each probe gets a one-line entry in `docs/dev/probes/m2-viewer.md` (new) describing: how to run it, what it validates, expected output / pass criterion.

| Probe | What it validates | Pass criterion |
|---|---|---|
| **1s-tick e2e timing** | Pixel write → visible-on-screen lag | A bot writing one pixel/sec for 60s; a viewer in another tab shows each pixel within ≤2s. Measure with a timestamp overlay on the canvas. |
| **iOS Safari mobile** | Mobile pan/zoom, default zoom level, performance | One-finger pan, two-finger pinch, double-tap, no janky scroll. Sub-jank perceived performance. |
| **Android Chrome mobile** | Same as above on Android | Same pass criteria. |
| **Desktop browsers** | Chrome + Safari + Firefox parity | Pan/zoom/keys all work; canvas renders crisp. |
| **CDN ETag round-trip** | `If-None-Match` returns 304 in production behind Vercel CDN | Probe with `curl -I -H 'If-None-Match: "<current>"'`; expect 304 and empty body. If Vercel rewrites/strips the ETag, fall back to `?v=<version>` cache busting (Risk R5). |
| **Cold-start TTFB** | Origin response time on `/manifest` cache miss | p95 `manifest` origin response < 100ms under realistic concurrent viewer load. If miss, escalate to Edge runtime (IM-3) before declaring M2 done. |
| **Vercel Firewall rate-limit** | 600 req/min/IP edge rule actually fires | A scripted burst of 700 req in 60s from one IP gets rate-limited at the edge. |
| **Empty-canvas first paint** | Cold sector renders default_color uniformly | Drop a fresh sector (hand-create `sector-test` with no chunks); viewer shows uniform palette-0 background, no errors. |

Acceptance: all eight probes pass on the production preview deploy *before* merging to main.

### Out of Scope (deliberate)

- **WebSockets / SSE realtime.** The 1s-tick target is met via polling. Realtime is an M5 question unless probes show polling can't hit ≤2s e2e.
- **Server-rendered PNG snapshots / CDN diff frames.** Defer until polling cost actually hurts.
- **Pixel attribution endpoint and UI** (`/public/sectors/:id/pixels/:x/:y/event`, click-pixel-to-see-bot). M3+ alongside bot DX.
- **Single-pixel public endpoint.** Original use cases don't apply yet; bots use authenticated reads; viewers always have the chunk locally.
- **Recent-events feed / activity panel.**
- **Human-painted pixels.** Bot-native forever.
- **"Your bots highlighted" / "follow this bot" / authenticated viewer features.** M3+.
- **Multi-sector grid / sector picker UI.** URL shape supports it; UI is trivial in M2.
- **Brand / visual identity polish.** Raw and minimal.
- **App-level rate-limit bucket on public reads** (unless Vercel Firewall fallback fires — see V5).
- **Open Graph / per-sector preview images.**
- **Demo bots seeded for launch.** Travis spins these up post-M2 ("M2.5") to make the canvas visibly active before any public announcement.
- **Cloudflare proxied DNS / WAF / Turnstile.** Separate decision; not part of M2.
- **Custom telemetry dashboards.** Vercel + Cloudflare default observability is the M2 bar; bespoke dashboards are M4.
- **Per-bot rate-limit tuning UI.**
- **Internationalization, accessibility audit beyond contrast basics.**

## Implementation Decisions

Four items the brainstorm flagged as needing discussion. Each is locked. Brainstorm context is preserved at [`plans/brainstorms/2026-05-09-m2-public-viewer.md`](../brainstorms/2026-05-09-m2-public-viewer.md#decisions-that-needed-discussion-resolved-2026-05-09).

### IM-1 — Manifest format: omit unwritten chunks (Option A)

The manifest endpoint returns only entries for chunks that have a `SectorChunk` row (i.e. have been written at least once). Unwritten chunks are absent.

Why:
- Smaller payload while the canvas is sparse.
- Forward-compatible: switching to "always include all chunks with `version: 0`" later is a non-breaking change.
- Simpler server query (one straightforward `SELECT` against `sector_chunks`).

Client implication: the canvas initializes to a uniform fill of `default_color` (palette index 0), then chunks paint over it as the manifest produces them.

### IM-2 — CDN cache durations under the 1s-tick budget

Locked at the table in V1. End-to-end worst case under this config: write commits at T=0, manifest CDN can be up to 1s stale (viewer sees up to T=1), client polls at T=1 (worst case +1s offset = T=2), chunk fetch happens immediately. **Worst-case ~2s, typical ~1.2s.** Inside the target.

If the V7 probe shows real-world misses exceeding 2s due to cache staleness, drop manifest `s-maxage` to 0 (origin-only) and retest. If misses exceed 2s due to *origin latency*, see IM-3.

### IM-3 — Vercel runtime: stick with Node

Public endpoints run on the existing Node runtime + Prisma + adapter-pg setup. CDN absorbs the polling load; origin sees ~1 manifest query per Vercel region per cache cycle. Origin latency budget under that load is well within Node's reach.

If the V7 cold-start TTFB probe shows origin p95 > 100ms on `/manifest` under realistic concurrent viewer load, escalate to Edge runtime + Neon's serverless HTTP driver as a follow-up before declaring M2 done. Don't pre-build Edge.

### IM-4 — Server component fetches metadata via HTTP, not Prisma

`app/sectors/[id]/page.tsx` calls `fetch('/api/v1/public/sectors/' + id)` (with Next's auto-deduped fetch + revalidation) instead of importing Prisma directly. This keeps the server component on the CDN-cached path — every fresh page load reuses the cached metadata response — and avoids a Prisma cold-start hit per visitor.

## Validation Strategy

Same shape as M1: structured-log line per request, integration tests against a real DB, manual probes for everything that interacts with browser/CDN reality.

Manual verification matrix:

| Claim | How to verify |
|---|---|
| Public endpoints return 200 against real DB | Run `tests/api/public-endpoints.test.ts` against a Neon dev branch with `sector-1` seeded |
| Cache headers match the V1 table | `curl -I` each endpoint in production, assert headers verbatim |
| ETag round-trip works behind Vercel CDN | V7 ETag probe |
| 1s-tick e2e timing | V7 1s-tick probe |
| Mobile pan/zoom feels right on real devices | V7 iOS + Android probes |
| Vercel Firewall edge rate-limit fires | V7 Firewall probe |
| Empty canvas renders cleanly | V7 empty-canvas probe |
| Server log line includes `auth_type: "public"` | Hit `/api/v1/public/sectors/sector-1` with no auth, grep server logs |
| Pixel write visible to public viewer within 2s | Bot writes pixel, two viewers (desktop + iPhone) both see it within 2s |

Re-run the principle review (`/project:review`) once code is in to catch consensus P1/P2 findings, same gate as M1.

## Acceptance Criteria

- [ ] All seven themes (V1–V7) addressed in code + docs.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` clean locally and in CI.
- [ ] Every V7 probe documented in `docs/dev/probes/m2-viewer.md` and verified passing on the production preview deploy.
- [ ] Vercel Firewall rules configured and documented in `docs/admin/v1.md`.
- [ ] `docs/api/v1.md` updated with the public-endpoints section; `docs/dev/viewer.md` exists and is linked from `docs/README.md`.
- [ ] Production smoke: `https://botplace.app/` shows the canvas; a bot write is visible within 2s; the iPhone view works.
- [ ] `README.md` updated to reflect M2 shipped.
- [ ] Brainstorm doc flips from `status: in-progress` to `status: adopted` once this PR lands; this requirement flips from `status: draft` to `status: shipped`.

## Open Questions

These are smaller-scope deliberation items that *don't* gate the requirement but should be answered during implementation:

- **Sign-out of the relocated `/account`.** Today the form-action sign-out lives in `app/page.tsx`. Confirm the move to `/account` doesn't break the existing Auth.js redirectTo flow.
- **`/api/v1/public/sectors/:id` shape vs the authenticated `/sectors/:id`.** Same JSON or carefully de-overlap? Recommend identical shape so the public endpoint can be a CDN-cached front for clients that don't need auth — but call this out so we don't accidentally diverge.
- **Sector metadata cache invalidation.** Sector dimensions almost never change, but if we ever do (e.g. multi-sector M3+), `s-maxage=60` on the metadata endpoint means up to 60s of stale dimensions. Probably fine, document it.
- **Mobile default zoom tuning.** Fit-to-viewport at 1000×1000 on a 390px-wide iPhone screen is ~0.39× scale, individual pixels ~0.4px. Probably too small to see anything. Implementation should pick a sensible mobile-first default and verify on real device.
- **Chunk request burst on cold load.** First-paint fetches every chunk in the manifest in parallel. For a fully-written `sector-1`, that's 100 simultaneous requests. Vercel CDN handles this fine, but throttle client-side to e.g. 10 concurrent if it visibly stutters.
- **Tab-pause semantics on mobile.** Mobile Safari throttles backgrounded JavaScript hard. Confirm `visibilitychange` fires correctly when locking/unlocking the phone; if not, the only impact is an extra catch-up fetch on resume, which is fine.

## Possible Future Enhancements

- **Single-pixel public endpoint** with attribution (M3 with bot DX).
- **Click-a-pixel-to-see-bot UI** (M3).
- **SSE/WebSocket pixel-delta stream** as additive on top of the polling API (M5 if probes show polling falls short, otherwise M5 question).
- **Server-rendered PNG snapshots** for OG previews and CDN diff frames (M5+).
- **Multi-sector grid / sector picker UI** when more than one sector exists.
- **Cloudflare proxied DNS + WAF + Turnstile** if Vercel-only anti-abuse proves insufficient.
- **Custom telemetry dashboards** in M4 (operational hardening).
- **Brand / visual identity** as a separate stream we'll start soon.
- **Demo bots in-repo** as starter examples (M3 territory once they exist).

## References

- Source brainstorm: [`plans/brainstorms/2026-05-09-m2-public-viewer.md`](../brainstorms/2026-05-09-m2-public-viewer.md).
- MVP brainstorm Milestone 2 commitment: [`plans/brainstorms/2026-05-06-mvp-scope-and-hosting.md`](../brainstorms/2026-05-06-mvp-scope-and-hosting.md#milestone-2-current-canvas-state-and-public-viewer).
- Parent shipped milestone: [`plans/requirements/requirement-20260508-1121-milestone-1-bot-registration-and-pixel-api.md`](requirement-20260508-1121-milestone-1-bot-registration-and-pixel-api.md).
- Project principles: [`docs/design/principles.md`](../../docs/design/principles.md).
- API surface: [`docs/api/v1.md`](../../docs/api/v1.md).
- Deploy + DNS posture: [`docs/dev/deploy.md`](../../docs/dev/deploy.md).

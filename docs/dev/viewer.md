# Public viewer architecture

The M2 public viewer at <https://botplace.app> renders sector canvases for human visitors. This doc covers the data path, the rendering choices, and the assumptions that drive them.

If you're looking for the API contract, see the hosted [API reference](https://botplace.app/build/api). This doc is for contributors hacking on the viewer code.

## Data path at a glance

```
       1Hz tick
client ──────────► /api/v1/public/sectors/:id/manifest        (CDN s-maxage=1)
       │
       │ for each chunk where remote.version > local.version:
       │
       └──────────► /api/v1/public/sectors/:id/chunks/:cx/:cy  (CDN s-maxage=1, ETag)
                    └ 304 short-circuit when ETag matches
```

End-to-end timing (write → visible on screen):

| Stage | Worst case |
|---|---|
| Write commits server-side | T = 0 |
| Manifest CDN hits stale cache (`s-maxage=1`) | up to T = 1 |
| Client tick fires (1s interval, may have just polled) | up to T = 2 |
| Chunk fetch + repaint | < 100ms |
| **Total worst case** | **≈ 2s** |

Typical is ~1.2s. The 2s budget is the M2 acceptance bar; if probes ever miss it, the escape hatches are documented in the [M2 requirement](../../plans/requirements/requirement-20260509-1711-milestone-2-public-viewer.md#im-2--cdn-cache-durations-under-the-1s-tick-budget).

## File layout

```
app/
  page.tsx                    Root: renders <ViewerPage sectorId="sector-1" />
  sectors/[id]/page.tsx       Canonical /sectors/:id route
  account/page.tsx            Sign-in shell (relocated from /)
src/
  viewer/
    viewer-page.tsx           Server component: fetches metadata via the
                              public HTTP endpoint (IM-4) so SSR rides the
                              same CDN cache as client refreshes
    sector-viewer.tsx         Client orchestrator: chunk cache, poll loop,
                              pan/zoom event handling
    canvas.tsx                Canvas-2D paint surface; Uint32 palette + dirty-
                              rect putImageData per chunk
    chunk-cache.ts            Pure: per-tab cache + manifest-diff
    poll-loop.ts              Pure: 1s scheduling + backoff + abort
    viewer-fetch.ts           Network glue (fetch impl injected for tests)
    pan-zoom.ts               Pure: transform math, screen ↔ world inversion
tests/viewer/                 Mirror of src/viewer with .test.ts files
```

The pure modules (`chunk-cache`, `poll-loop`, `pan-zoom`, `viewer-fetch`) have unit tests. The React components are exercised via the manual probe matrix below.

## Why these choices

### Polling, not realtime
The MVP brainstorm explicitly defers realtime to M5. Polling at 1Hz with manifest-diff lets the CDN edge absorb most reads (a viewer ticking every second hits cached responses ~99% of the time), and it's a prerequisite for any realtime measurement we'd do later (we can't decide if SSE/WebSocket is worth it without knowing the polling baseline).

### Manifest omits unwritten chunks (IM-1)
A fresh sector has zero chunk rows; a fully-written 1000² sector has 100 rows. Omitting unwritten chunks keeps the manifest payload small (~5KB max) and makes "never written" an unambiguous signal. The viewer fills unwritten regions with the sector's `default_color` (palette index 0) before any chunks paint.

### Canvas 2D, not WebGL
1000×1000 pixels at 1 byte each = 1MB world. Painting it as a single `ImageData` with `putImageData` is well within Canvas 2D's reach on every supported browser. WebGL adds a shader pipeline and texture upload bookkeeping for no measurable win at this scale.

The palette is pre-computed as a `Uint32Array` of RGBA-little-endian values, indexed by palette index. Each chunk repaint walks the chunk's 10000 bytes, indexes into the palette, and writes Uint32-aligned through a `Uint32Array` view of the ImageData buffer — fast enough that we don't need OffscreenCanvas in M2.

### CSS-driven pan/zoom, not canvas-internal transform
The canvas pixel buffer stays 1:1 with the world; CSS handles all zoom/pan via `transform: translate scale`. This means:
- `image-rendering: pixelated` keeps pixels crisp at any zoom level.
- We never re-paint the canvas during pan/zoom — only the CSS transform updates.
- The expensive operation (palette → RGBA write) only happens when chunks actually change.

### Pointer Events, not separate mouse + touch
One event model handles desktop mouse, mobile touch, and trackpad. Multi-touch (pinch) is implemented by tracking pointers in a `Map<pointerId, point>` and computing distance + midpoint between active pointers when count == 2. `touch-action: none` on the wrapper prevents the browser's default pan/zoom from intercepting our gestures.

### Server component calls the shared loader directly (was IM-4 → revised post-review)
`viewer-page.tsx` calls `loadSectorMeta()` from `src/sectors/` directly. The first M2 implementation looped back through the public HTTP endpoint to share its CDN cache, but that shape used `headers().get('host')` as the URL authority of an outbound fetch — an attacker-controlled `Host` header would have redirected the SSR fetch (M2 review P1.1). Calling Prisma directly closes the SSRF surface; the route handler's response cache is unaffected because Vercel caches it independently of who calls the underlying loader.

### Node runtime, not Edge (IM-3)
Public endpoints run on the existing Node runtime + Prisma + adapter-pg setup. CDN absorbs the polling load; origin sees ~1 manifest query per Vercel region per cache cycle. The latency budget under that load is well within Node's reach, so the cost of switching to Edge + Neon's serverless HTTP driver isn't justified yet. Escalation criterion: if the V7 cold-start TTFB probe shows origin p95 > 100ms on `/manifest` under realistic concurrent viewer load, revisit.

### Layered anti-abuse: in-app floor + edge optimization
The M2 brainstorm landed on "lean on Vercel + Cloudflare anti-abuse defaults" and the M2 review (P1.3) clarified that an in-app floor still pulls weight as defense in depth. So both layers ship:

- **In-app floor (always on):** `PUBLIC_READ` bucket in `lib/rate-limit.ts`, 60/sec/IP, fail-closed if Upstash is unreachable. Wired into all three `/api/v1/public/*` handlers; emits `X-RateLimit-Remaining-Public-Read`.
- **Edge optimization:** Vercel Firewall rules per [`admin/v1.md § Public endpoint Firewall rules`](../admin/v1.md#public-endpoint-firewall-rules). Operator-configured post-deploy. Catches abuse before it reaches origin.

The floor protects against the case where the Firewall rule isn't applied yet (between merge and operator action), the Firewall has a config drift, or traffic somehow bypasses the edge.

## Adding a new public endpoint

1. Route handler under `app/api/v1/public/...`. No auth, structured log line per response with `auth_type: "public"`, `Cache-Control` header set per the table in `/build/api`.
2. Update the public-endpoints integration test (`tests/api/public-endpoints.test.ts`) to cover the new path.
3. Document in `src/build-docs/content/api.ts` so the hosted `/build/api` page updates.
4. If anti-abuse posture is in scope (e.g. higher cost than chunk reads), update the Firewall rules in `docs/admin/v1.md`.

## Adding a viewer feature

The pure modules are testable in isolation. Anything new that's pure goes in `src/viewer/<name>.ts` with a matching `tests/viewer/<name>.test.ts`. UI work in `sector-viewer.tsx` or `canvas.tsx` doesn't get unit tests; the [M2 probes](probes/m2-viewer.md) are the merge gate.

## Manual probes

When you change anything in `src/viewer/` or the public endpoints, run the manual probes in [probes/m2-viewer.md](probes/m2-viewer.md) before merging. They cover:

- 1s-tick end-to-end timing
- iOS Safari + Android Chrome touch
- CDN ETag round-trip
- Cold-start TTFB
- Vercel Firewall edge rate-limit
- Empty-canvas first paint

The mobile probes are not optional. Mobile parity is an M2 merge bar.

---
date: 2026-05-09
target: feat/m2-public-viewer (PR #11) — M2 public canvas viewer implementation
target_commit: 8c87abf
review_type: multi-reviewer-principle
status: p1-addressed
---

## Disposition (added 2026-05-09 after review)

Decisions on the 5 P1 findings, made by Travis post-review:

- **P1.1 SSRF** — **Fixed.** Extracted `loadSectorMeta` into `src/sectors/index.ts`; both the public route handler and the server component call it directly. The HTTP loopback is gone, the SSRF surface with it.
- **P1.2 Rollback path** — **Skipped intentionally.** Pre-public release; no real users yet. The cost of the env-var flag isn't justified at this stage. Re-evaluate when M2.5 demo bots and any public announcement land.
- **P1.3 V5 fallback / public-read rate limit** — **Fixed.** Added `PUBLIC_READ` bucket (60/sec/IP, capacity 60) to `lib/rate-limit.ts`, wired into all three public route handlers. The Vercel Firewall edge rule remains the first line; this is the in-app floor.
- **P1.4 / P1.5 Plan branch coordination** — **Fixed.** Cherry-picked the three planning commits (`469f3d1`, `83b4f7e`, `cf678cc`) onto `feat/m2-public-viewer`. PR #10 will be closed in favor of #11; the brainstorm + requirement + implementation now ship as one merge unit. Cross-references resolve.

Bundled with P1.3: the **P2.5 canonical-coord regex** (`^(0|[1-9][0-9]{0,3})$`) on `chunk_x`/`chunk_y` path segments — defense in depth on cache-key fragmentation, small enough to land alongside the rate-limit work. P2.3 (try/catch around Prisma calls in public handlers) also folded in — same code surfaces being touched.

P2 and P3 findings remain open; the rest of the M3 / polish window can address them.

---

# Review: M2 Public Canvas Viewer Implementation

## Target

- Branch: `feat/m2-public-viewer` (commit `8c87abf`)
- PR: [botplace#11](https://github.com/travisfischer/botplace/pull/11)
- Diff vs `main`: 23 files, ~2519 insertions
- Scope: V1 (3 public read endpoints) + V2 (viewer page routes) + V3 (chunk-cache + poll-loop + viewer-fetch) + V4 (canvas + mobile-first pan/zoom) + V6 (docs)
- Deferred to deploy-time: V5 (Vercel Firewall config) + V7 (8 manual probes)
- Companion planning PR: [botplace#10](https://github.com/travisfischer/botplace/pull/10) (brainstorm + requirement on `plan/m2-public-viewer-brainstorm`)

## Reviewers

Sixteen principle reviewers from `agent-engineering/0.2.0`, dispatched in parallel:

| Reviewer | Findings (P1/P2/P3) |
|---|---|
| how-we-build/agent-native | 0 / 2 / 3 |
| how-we-build/coding-agent-plurality | 0 / 0 / 1 |
| how-we-build/cloud-coding | 0 / 2 / 1 |
| how-we-build/compound-engineering | 1 / 1 / 1 |
| how-we-build/goldilocks-scoping | 0 / 3 / 3 |
| how-we-build/observability-and-incidents | 0 / 2 / 3 |
| how-we-build/prompt-and-eval-lifecycle | — N/A |
| how-we-build/quality-first | 0 / 0 / 4 |
| how-we-build/release-and-rollout | **2** / 2 / 0 |
| how-we-build/sacred-schema | 0 / 0 / 3 |
| how-we-build/security-and-privacy | **1** / 2 / 3 |
| core/agent-native | 0 / 1 / 2 |
| core/autonomous-learning | — N/A |
| core/llm-model-fluid | — N/A |
| core/markdown-everything | **1** / 2 / 2 |
| core/universal-evals | — N/A |
| **TOTAL** | **5 P1 / 17 P2 / 26 P3** |

Four reviewers (prompt-and-eval-lifecycle, autonomous-learning, llm-model-fluid, universal-evals) wrote no-findings statements because M2 has no LLM/eval surface.

## Executive Summary

The implementation is principle-aligned at the architecture level — pure modules with unit tests, structured logging consistent with M1, ETag/304 short-circuit, mobile-first pan/zoom, no schema changes, CDN cache as the scaling lever. The findings cluster around **release readiness**, **security boundary** on the SSR loopback, and **artifact completeness** (planning docs on a separate branch).

**P1 ship-blockers (5, all resolvable in code or process):**

1. **SSRF in `viewer-page.tsx` SSR fetch** (security-and-privacy R1) — server component reads attacker-controlled `Host` header and uses it as the authority of an outbound `fetch`.
2. **No rollback path for homepage relocation** (release-and-rollout F1) — `/` flips for everyone at merge with no flag and no documented revert recipe.
3. **V5 anti-abuse documented but not coded** (release-and-rollout F2) — public endpoints expose `s-maxage=1` paths with zero rate ceiling between merge and operator dashboard action.
4. **Plan artifacts on a different branch** (compound-engineering F1, markdown-everything F1) — the M2 brainstorm + requirement live on `plan/m2-public-viewer-brainstorm`, code references them via `docs/dev/viewer.md:29` and seven `IM-#`/`V#` labels in source comments. If the code branch merges first, those links dangle.
5. **`docs/dev/viewer.md:29` link 404s on merge** (markdown-everything F1) — same root cause as #4 viewed from the markdown side.

P1 #4 and #5 collapse to a single coordinated-merge issue. Net unique blockers: **4**.

**P2 themes (cross-reviewer consensus):**

- **Probe 8 is broken** (`pnpm prisma:studio` not in `package.json`, depends on GUI tool, requires temporary code edit) — flagged by agent-native, cloud-coding, markdown-everything.
- **Vercel Firewall has no IaC path** — flagged by agent-native (probe 7 dashboard-only), release-and-rollout, goldilocks-scoping (`PUBLIC_READ` fallback referenced as if implemented).
- **No try/catch around Prisma calls in public handlers** (observability F3) — Prisma exceptions skip the structured-log path.
- **No user-visible "stale/disconnected" affordance** (observability F2) — client outage signal swallowed in `console.warn`.
- **Speculative build-out** — `screenToWorld()`, `MAX_SCALE=16` (spec says 8), unused `CanvasHandle.el()` and `ChunkCache.entries()` (goldilocks F1, F2, F5).
- **Missing V3 spec'd `Retry-After` handling** (goldilocks F3).
- **Manifest + ETag/304 primitives only on public surface, not authenticated** (core/agent-native F1).
- **Probe headlessness story missing** (cloud-coding F1) — agents can't tell which probes need a real device.

**P3 themes:**

- `request_id` not echoed on success responses (observability F1, core/agent-native F3).
- React components ship with no automated tests (quality-first F1).
- `If-None-Match` parser is strict-equal, not RFC-7232-compliant (quality-first F2).
- Cold-load chunk fetches are serial (quality-first F4).
- Design rationale duplicated between `docs/dev/viewer.md` and source block comments (markdown F3).
- Manifest `orderBy` doesn't match the SectorChunk PK natural sort (sacred-schema F1).
- Probe matrix not surfaced from `AGENTS.md` (coding-agent-plurality F3).
- Probe runbook lacks "expected log evidence" lines (observability F4).
- No Attack-Challenge-Mode kill-switch rehearsal probe (observability F5).
- Stale `README.md` after merge until V7 verifies (release F4).

## P1 Findings (Resolve Before Merge)

### P1.1 — SSRF via attacker-controlled `Host` header in SSR fetch

**Reviewer:** how-we-build/security-and-privacy F1

`src/viewer/viewer-page.tsx:17-29` reads `headers().get("host")` and uses the value as the authority of an outbound `fetch` to `/api/v1/public/sectors/${sectorId}`. The `Host` header is attacker-controlled — Vercel routes by SNI but forwards the client-supplied `Host` into the function as a header. An attacker who reaches Vercel's edge with a hostile `Host` causes the server-side runtime to issue requests to a host they control; the response is parsed as JSON and the `name` field rendered into the page HTML. This is a textbook outbound-SSRF + Host-header-poisoning primitive.

**Fix (preferred):** Drop the HTTP loopback. Extract a shared `getSectorMeta` helper into `src/sectors/` and call it from both the route handler and the server component. SSR caching is provided by Next's data cache for the route, not by the loopback hop.

**Fix (alternative):** Pin the loopback target to a server-side configured base URL — `process.env.VERCEL_PROJECT_PRODUCTION_URL`, `process.env.VERCEL_URL` for previews, or a `BOTPLACE_CANONICAL_URL` env var — and validate `x-forwarded-proto` against `{"http","https"}`.

Either fix removes the SSRF entirely.

### P1.2 — No rollback path for the homepage relocation

**Reviewer:** how-we-build/release-and-rollout F1

`app/page.tsx` hard-replaces the previous Google sign-in shell with `<ViewerPage sectorId="sector-1" />`. There are no feature flags in the project, so the only "disable path" is a full revert — which also rips out the public endpoints, the `/sectors/[id]` route, and `/account` in one shot. If a real-device probe surfaces a regression post-deploy, the operator has no scalpel.

**Fix (preferred):** Add a `BOTPLACE_VIEWER_ENABLED` env-var gate in `app/page.tsx` (and `app/sectors/[id]/page.tsx`) so an operator can flip `/` back to the old sign-in shell from Vercel project env without redeploying. Endpoints stay up. The "no feature flags" stance is the fast-iteration default; this is the asymmetric blast-radius case it was meant to allow.

**Fix (alternative):** Document a rollback recipe in `docs/admin/v1.md` § "M2 rollback" naming the exact `git revert` SHA, what to keep up (`/api/v1/public/*` is harmless), and the order of operations.

### P1.3 — V5 (Vercel Firewall) documented but not coded; public endpoints ship with no anti-abuse on day one

**Reviewer:** how-we-build/release-and-rollout F2

Three new no-auth endpoints with `s-maxage=1` on the hot paths land in production the moment the PR merges. Anti-abuse runs at the Vercel Firewall edge per the M2 design, but the rules live in `docs/admin/v1.md` as a manual recipe applied via dashboard post-deploy. Between merge-time and the operator clicking through Firewall → New Rule, the viewer is exposed with no rate ceiling. The documented in-app fallback (`PUBLIC_READ` bucket at 60/sec/IP) is also not coded — `git diff main..feat/m2-public-viewer -- lib/rate-limit.ts` is empty.

**Fix:** Ship the documented fallback (`PUBLIC_READ` bucket at 60/sec/IP) in `lib/rate-limit.ts` and wire it into the three public route handlers as the merge-time floor. Operator layers the Vercel Firewall rule on top as a higher ceiling. This makes the system the team merges have anti-abuse on without depending on a synchronous human action.

### P1.4 — Plan artifacts (M2 brainstorm + requirement) not on the implementation branch

**Reviewers:** how-we-build/compound-engineering F1 + core/markdown-everything F1 (same root cause)

The M2 brainstorm and requirement docs were authored on `plan/m2-public-viewer-brainstorm` ([PR #10](https://github.com/travisfischer/botplace/pull/10)) and never merged into `feat/m2-public-viewer`. Code references them via:

- `docs/dev/viewer.md:29` — `[M2 requirement](../../plans/requirements/requirement-20260509-1711-milestone-2-public-viewer.md#im-2--cdn-cache-durations-under-the-1s-tick-budget)` (link 404s post-merge to main).
- `IM-1` / `IM-3` / `IM-4` / `V5` / `V7` labels in `docs/dev/viewer.md`, `docs/dev/probes/m2-viewer.md`, `src/viewer/chunk-cache.ts:4`, `src/viewer/viewer-page.tsx:2`, `app/api/v1/public/sectors/[id]/manifest/route.ts:2-5`, `app/api/v1/public/sectors/[id]/route.ts:3-4`.

If `feat/m2-public-viewer` merges before `plan/m2-public-viewer-brainstorm`, the cross-references dangle and the artifact chain that compound engineering relies on is broken.

**Fix (preferred):** Merge [#10](https://github.com/travisfischer/botplace/pull/10) first, then [#11](https://github.com/travisfischer/botplace/pull/11). M1 set this precedent — the M1 polish requirement and implementation shipped together.

**Fix (alternative):** Cherry-pick the requirement commits onto `feat/m2-public-viewer` so both land together.

**Codify:** Add a one-liner to `AGENTS.md` so the next milestone doesn't repeat the split-branch shape.

## P2 Findings (Address Before Declaring M2 Shipped)

### P2.1 — Probe 8 ("Empty-canvas first paint") is broken on three counts

**Reviewers:** how-we-build/agent-native F1, how-we-build/cloud-coding F2, core/markdown-everything F4

`docs/dev/probes/m2-viewer.md:127-134` says:

```
pnpm -s prisma:studio  # then add a Sector row with id="sector-empty-probe"
```

Three problems:
1. `prisma:studio` is not a script in `package.json` — the command fails with "not found".
2. Prisma Studio is a desktop GUI tool — agents can't run it headless.
3. The probe also requires "you'll need to temporarily allow the id past the M2-only sector-1 guard in `app/sectors/[id]/page.tsx`" — i.e., a transient code edit, anti-pattern for an agent-runnable probe.

**Fix:** Add a `pnpm sector:create-probe` script under `scripts/sectors/` (one-off Prisma raw query inserting a sector row, mirroring the `scripts/admin/` pattern). Replace the probe step with that script. Or move the M2-only guard behind an env-var allow-list (`M2_SECTOR_ALLOWLIST`) so the probe is a single env override + GET.

### P2.2 — Vercel Firewall has no scripted/IaC path

**Reviewers:** how-we-build/agent-native F2, how-we-build/release-and-rollout F2, how-we-build/goldilocks-scoping F6

`docs/admin/v1.md:103-110` documents the Firewall rules as "Configure the following rules in Vercel project → Firewall." No `pnpm` script, no Vercel REST/GraphQL invocation, no Terraform/Pulumi reference. This is the same anti-pattern the rest of `docs/admin/v1.md` explicitly forbids: "Without the script, the agent-native principle is broken on the operator surface" (line 97). M2 makes Firewall configuration a load-bearing operator surface and silently regresses the bar.

The `PUBLIC_READ` rate-limit fallback referenced in `docs/dev/viewer.md:84-85` and `docs/admin/v1.md:114` also doesn't exist in code (`git diff main..feat/m2-public-viewer -- lib/rate-limit.ts` is empty). The doc reads as if it's a switch flip; it's vapor.

**Fix:** Either ship `scripts/admin/firewall-rules.{sh,ts}` that PUTs the rule set via the Vercel REST API (using `VERCEL_TOKEN`, JSON definition inline), or land the M2 in-app fallback bucket (P1.3 fix) so the documented fallback is real and the Firewall layer is a pure optimization on top.

### P2.3 — Public route handlers have no try/catch; Prisma exceptions skip the structured log

**Reviewer:** how-we-build/observability-and-incidents F3

`app/api/v1/public/sectors/[id]/route.ts:24-33`, `manifest/route.ts:30-59`, and `chunks/[chunk_x]/[chunk_y]/route.ts:57-98` all call Prisma outside any try/catch. Neon connection storms, query timeouts, pool exhaustion all produce Next's default 500 page with **zero** JSON log lines. M1's pixel-write handler wraps every error path in a structured log; M2 breaks the pattern on the highest-RPS surface.

**Fix:** Wrap each handler body in `try { … } catch (err) { log("error", { request_id, path, status: 500, error_slug: "internal_error", auth_type: "public", sector_id, latency_ms: Date.now() - startedAt, dependency: "neon" }); return Response.json({ error: "internal_error", request_id }, { status: 500 }); }`. Optionally add `error_class: err?.constructor?.name`.

### P2.4 — Client viewer swallows fetch failures with no user-visible signal

**Reviewer:** how-we-build/observability-and-incidents F2

`src/viewer/poll-loop.ts:38` defaults `onError` to `console.warn`. `sector-viewer.tsx:106` instantiates without overriding. Combined with the CDN's `stale-while-revalidate=300`, an outage of the manifest or chunk endpoint can keep showing 5-minute-stale pixels with no signal to the user and no alertable server-side telemetry. Only detection path is an operator manually running probe #1.

**Fix:** When the poll loop's backoff exceeds a threshold (e.g., 3 consecutive failures), surface a small "Reconnecting…" or "Live updates paused" affordance in the viewer chrome. The user becomes the detection layer for free.

### P2.5 — Path-parameter normalization gap permits CDN cache-key fragmentation

**Reviewer:** how-we-build/security-and-privacy F2

`Number()` accepts `"01"`, `"+0"`, `"0e0"`, `"0x0"`, `"0b0"`, `"0.0"` as integer-valued. The chunk endpoint coerces with `Number()` then validates with `Number.isInteger()`. CDNs key on URL path, not parsed value, so each variant becomes its own cache entry. Without the in-app rate limit (P1.3), an attacker can mint many distinct cache keys per real chunk — bandwidth/CPU amplification primitive against origin.

**Fix:** Reject path segments that don't match `^(0|[1-9][0-9]{0,3})$` before `Number()`. Add a regression test under `tests/api/public-endpoints.test.ts` covering the eight non-canonical forms.

### P2.6 — Server-component fetch lacks `AbortSignal` / timeout

**Reviewer:** how-we-build/security-and-privacy F3

`src/viewer/viewer-page.tsx:26` does `await fetch(url, { next: { revalidate: 60 } })` with no timeout. Compounds the SSRF (P1.1) into a request-pinning DoS — an attacker who can both inject a `Host` and hold their server in slow-response mode pins origin function instances cheaply. Even after P1.1 is fixed, a slow loopback path consumes a function instance the entire time it waits.

**Fix:** Add `signal: AbortSignal.timeout(2000)` and treat both timeout and non-2xx the same way (return `null` and render the empty branch). If P1.1's "drop the loopback" remediation is taken, this is moot.

### P2.7 — `screenToWorld()` is speculative build-out for M3

**Reviewer:** how-we-build/goldilocks-scoping F1

`src/viewer/pan-zoom.ts:132-146` exports `screenToWorld()` with comment "Useful for hover labels and future click-to-inspect" — i.e. the author wrote it knowing it has no current call site. M2 requirement Out of Scope explicitly defers click-to-see-bot to M3. `tests/viewer/pan-zoom.test.ts:90-108` adds tests for it.

**Fix:** Drop the function and its tests. When M3 click-to-inspect lands, restore both as part of that PR (<15 lines).

### P2.8 — `MAX_SCALE = 16` diverges from requirement-spec'd `[0.1, 8]`

**Reviewer:** how-we-build/goldilocks-scoping F2

`src/viewer/pan-zoom.ts:32` ships `MAX_SCALE = 16`. The M2 requirement V4 says "Zoom levels clamped to `[0.1, 8]`" with explicit justification. Either the requirement is wrong or the code is wrong; silently shipping a different number is the worst outcome because future reviewers won't know which value was intended.

**Fix:** Either change to `MAX_SCALE = 8` to match the requirement, or amend the requirement (and update the comment in `pan-zoom.ts`) to record why `16` was chosen.

### P2.9 — V3 spec'd `Retry-After` / 429 backoff handling is missing

**Reviewer:** how-we-build/goldilocks-scoping F3

Requirement V3 specifies "`429` from edge: respect `Retry-After`, double the poll interval until success" and "`503 rate_limit_unavailable`: same backoff posture as 429." The shipped poll-loop has generic exponential backoff on any error, but `viewer-fetch.ts:36-38, 84-86` throws a generic `Error("manifest 429")` without surfacing `Retry-After`, and `poll-loop.ts:88-101` ignores it. Backoff doubling eventually catches up by accident, but the spec'd behavior isn't implemented.

**Fix:** Have `viewer-fetch` throw a typed error carrying `retryAfterSeconds` parsed from the header, and have `PollLoop.run()` use it as a floor on the next schedule. Or explicitly downgrade in `docs/dev/viewer.md` with the same "deferred to deploy time" framing.

### P2.10 — Manifest + ETag/304 primitives only on public surface, not authenticated

**Reviewer:** core/agent-native F1

The viewer's data path introduces two genuinely new primitives: a per-sector manifest and `ETag` + `If-None-Match` short-circuit. Bots that today want to mirror a sector are stuck N+1-polling `/api/v1/sectors/:id/chunks/x/y` and re-downloading every chunk on every tick — the authenticated chunk endpoint emits `X-Chunk-Version` but no `ETag` (`app/api/v1/sectors/[id]/chunks/[chunk_x]/[chunk_y]/route.ts:162-181`). The agent-native commitment is "every meaningful user action has an agent path." Public-readable humans get the new primitives; authenticated bots don't. The structural anti-pattern is that agents are rewarded for going through the human door (skipping per-bot rate accounting).

**Fix:** Mirror the primitives on the authenticated surface: `GET /api/v1/sectors/:id/manifest` and `ETag`/`If-None-Match` on the authenticated chunk endpoint. Two route changes; a couple of headers each.

### P2.11 — Probe matrix doesn't state which probes are headless-runnable

**Reviewer:** how-we-build/cloud-coding F1

`docs/dev/probes/m2-viewer.md` lists 8 probes including "Lock phone, wait 30s, unlock" (Probe 2). Neither the probes doc nor `docs/dev/viewer.md` says which probes need a real device vs which can run from a headless cloud sandbox. The cloud-coding principle requires browser-dependent workflows to state whether headless execution is sufficient.

**Fix:** Add a "Headlessness" column to the probe matrix mapping each row to one of: headless-OK (curl), needs a real browser (Playwright/Chromium in cloud env), needs a real mobile device (handoff required).

### P2.12 — Pre-merge subset of probe matrix is undefined

**Reviewer:** how-we-build/release-and-rollout F3

The 8-probe matrix takes ~30 minutes, includes a >5min idle wait (Probe 6) and real-device mobile passes (Probes 2+3). The probes hardcode `https://botplace.app` (production) so they aren't easily run against the preview deploy. Nothing prevents merge-and-auto-deploy from shipping before any probe runs.

**Fix:** Split the matrix into "pre-merge against preview" (Probes 1, 4, 5, 8 — desktop, ETag round-trip, empty canvas; cheap and run against `https://<preview>.vercel.app`) vs "post-deploy against production" (Probes 2, 3, 6, 7). Make the pre-merge subset the merge gate (PR description checklist). Parameterize the URL via `${BOTPLACE_URL:-https://botplace.app}`.

### P2.13 — Deferred work has ambiguous merge-blocking status

**Reviewer:** how-we-build/release-and-rollout F4

Two items are named in the brainstorm but their relationship to the M2 ship-line is implicit:
- **M2.5 demo bots** — Travis's separate operator-side follow-up to make the empty canvas visibly active before any public announcement. No requirement doc, no commit reference.
- **README.md status flip** — held until V7 prod verification. Currently `README.md` line 15 says "The homepage is still an intentional placeholder," which is true on `main` and false the moment this PR merges.

**Fix:** Add a short "M2 rollout order" section (in `docs/admin/v1.md` or PR description) naming the steps and order: preview probes pass → merge → operator applies Firewall rule → production probes pass → M2.5 demo bots seeded → README flips → public announcement.

### P2.14 — Missing M2 review artifact in `plans/reviews/`

**Reviewer:** how-we-build/compound-engineering F2

M1 has two review docs in `plans/reviews/`. M2 has none — Plan→Work→Review→Compound is incomplete. This document is the fix; landing it in `plans/reviews/` as part of the merge train closes the loop.

**Fix (this document does it):** Land this synthesized review at `plans/reviews/review-20260509-1835-m2-public-viewer-implementation.md` either in this PR or a tiny follow-up before declaring M2 shipped.

### P2.15 — Doc rationale duplicated between `docs/dev/viewer.md` and source comments

**Reviewer:** core/markdown-everything F3

Multiple pieces of design rationale exist in two places with no pointers between them:
- "Pointer events / `touch-action: none`" — `src/viewer/sector-viewer.tsx:8-10` AND `docs/dev/viewer.md § Pointer Events`.
- "CSS transform pan/zoom; canvas pixel buffer 1:1" — `src/viewer/canvas.tsx:10-11` AND `docs/dev/viewer.md § CSS-driven pan/zoom`.
- "Manifest omits unwritten chunks (IM-1)" — three places: `chunk-cache.ts:4-7`, `viewer.md`, `manifest/route.ts:2-5`.
- "No app-level rate limit" — three places: `route.ts:3-4`, `viewer.md § No app-level rate limit`, `admin/v1.md § Public endpoint Firewall rules`.

A future change to one will not be reflected in the others — exactly the trap the markdown-everything principle is designed to avoid.

**Fix:** Pick canonical homes per piece of rationale, leave one-liner pointers at the others. Suggested anchors:
- Pan/zoom + canvas: `docs/dev/viewer.md § Why these choices` (drop the long-form block comments in source, keep one-line pointers).
- Anti-abuse posture: `docs/admin/v1.md` (drop the duplicates in `viewer.md` and `route.ts`).

### P2.16 — `docs/dev/probes/README.md` TOC missing `m2-viewer.md`

**Reviewer:** core/markdown-everything F2

`docs/dev/probes/README.md` lists `replay.md`, `redis-outage.md`, `concurrency.md`. No entry for `m2-viewer.md`, even though it's the merge gate per `docs/dev/viewer.md:96`.

**Fix:** Add a bullet to `docs/dev/probes/README.md` pointing at `m2-viewer.md`.

### P2.17 — Header link set diverges from V2 spec

**Reviewer:** how-we-build/goldilocks-scoping F4

V2 specifies exactly two links: "Build a bot" → API docs + sign-in; "Account" (signed-in only). The shipped header has three states: "API" (always-on, links to `/api/v1/public/sectors/sector-1`), "Build a bot" (unsigned, links to `/account`, not API docs), "Account" (signed-in, links to `/account`). Small unexplained drift.

**Fix:** Drop the "API" link or update the requirement. Point "Build a bot" at API docs (or the deployed equivalent) per V2 spec.

## P3 Findings (Carry Forward)

P3s are quality nits. Each cited inline; group by theme for follow-up triage.

### Wire/protocol nits

- **No `X-Request-Id` response header on success/304** — observability F1, core/agent-native F3. Fix: 1-line per route handler. Mirror the M1 admin pattern.
- **`If-None-Match` is strict-equal, not RFC-7232-compliant** — quality-first F2. Doc the limitation (1-line) or implement the parser.
- **`Vary: Accept-Encoding` missing on cached responses** — security-and-privacy F5. 1-line per route.
- **Synthetic-zero-blob distinguishability for out-of-bounds** — security-and-privacy F6. Fine for sector-1 today; comment for forward-compatibility.
- **Public log-fields type allows credential metadata to drift in** — security-and-privacy F4. Either narrow `PublicLogFields` or add a structural test.

### Code organization nits

- **Unused exports** `CanvasHandle.el()`, `ChunkCache.entries()` — goldilocks F5.
- **`compareVersion` invariant lives only in JSDoc** — quality-first F3. Add an assertion or use `BigInt(a) - BigInt(b)`.
- **Cold-load chunk fetches are serial** — quality-first F4. 1Hz steady state is fine; cold first-paint can be slow on a busy sector. Bounded-concurrency pool (4–8) or document the trade-off.
- **Manifest `orderBy` doesn't match SectorChunk PK natural sort** — sacred-schema F1. Either flip the public contract to `(chunk_x, chunk_y)` (rides the PK for free) or comment the post-scan sort.
- **`SectorChunk.version` stringification is now a public cache key** — sacred-schema F2. One-line comment on the schema column.
- **`select` on manifest intentionally omits `data` Bytes column** — sacred-schema F3 informational. Inline comment.

### Process / discoverability nits

- **AGENTS.md doesn't surface the probe gate** — coding-agent-plurality F3. One line: when changing `src/viewer/` or `app/api/v1/public/...`, run probes.
- **Probe runbook lacks "expected log evidence" lines** — observability F4. Two lines per probe.
- **No Attack-Challenge-Mode kill-switch rehearsal probe** — observability F5. Add Probe #9.
- **Probe 1 ("1s-tick e2e timing") pass criterion is "Eyeball it"** — agent-native F4. Add `scripts/probes/viewer-timing.sh` companion.
- **Polling cookbook in `docs/api/v1.md` is JS-only** — agent-native F5. Add a `curl` recipe (rest of the doc is shell-first).
- **Polling cookbook diverges from the in-repo viewer's behavior** — markdown-everything F5. Either soften the framing ("Minimal example.") and link out, or expand the cookbook.
- **`/account` and `/bots` paths not in agent-bootstrap example** — core/agent-native F2. Update `docs/api/v1.md:233`.
- **Requirement frontmatter still `status: draft`** — compound-engineering F3. Flip to `shipped` post-merge with a "Shipped vs deferred" subsection.
- **Viewer SSR portability doc gap** — cloud-coding F3. One-line note that the SSR fetch reads request-bound `host` (and how it'd behave in non-Vercel cloud envs).
- **React components ship with no automated tests** — quality-first F1. JSDOM-based component test for `<SectorViewer>` happy path would catch high-blast-radius integration wiring without a browser.

## No-Findings Reviewers

- **how-we-build/prompt-and-eval-lifecycle** — M2 has no LLM/prompt/eval surface.
- **core/autonomous-learning** — M2 has no LLM-powered self-improvement loop.
- **core/llm-model-fluid** — M2 has no LLM call sites.
- **core/universal-evals** — M2 has no model output to grade.

## Suggested Remediation Order

**Before merge (gates):**

1. **Merge [#10](https://github.com/travisfischer/botplace/pull/10) first** — closes P1.4 root cause + P2.14. (No code change.)
2. **Fix the SSRF (P1.1)** — drop the loopback or pin the base URL. **The single most important code change.**
3. **Add `BOTPLACE_VIEWER_ENABLED` flag (P1.2)** — restores the rollback path.
4. **Land the in-app `PUBLIC_READ` rate-limit fallback (P1.3)** — eliminates the merge-time anti-abuse gap.
5. **Wrap public route handlers in try/catch with structured `error` log (P2.3)** — the silent-500 class is the worst observability gap.
6. **Reject non-canonical chunk-coord paths (P2.5)** — defense in depth on cache-key fragmentation.

**Before declaring M2 shipped:**

7. **Fix Probe 8** (P2.1) — add `pnpm sector:create-probe` script; replace Prisma Studio step.
8. **Add IaC path or docs for Vercel Firewall** (P2.2) — script or explicit "no IaC" follow-up.
9. **`Retry-After` handling** (P2.9) — implement or downgrade in docs.
10. **Drop `screenToWorld()` + speculative exports** (P2.7, P2.5) and **align `MAX_SCALE`** with the spec (P2.8).
11. **Pre-merge probe subset** (P2.12) and **rollout-order doc** (P2.13).
12. **Mirror manifest + ETag onto authenticated surface** (P2.10) — closes the agent-native parity gap.
13. **User-visible "stale/disconnected" affordance** (P2.4).
14. **Land this review doc** at `plans/reviews/review-20260509-1835-...` (P2.14 fixed by the act of synthesis).
15. **Doc consolidation** (P2.15, P2.16, P2.17).

**Carry into M3 / polish PR:**

- All P3s.
- Add probe headlessness column (P2.11).

## Open Questions

- **Vercel `Host`-header forwarding behavior.** P1.1's exploitability assumes Vercel forwards client-supplied `Host` to the function. If Vercel rewrites it to the project canonical, P1.1 is still wrong as a pattern but downgrades severity. The fix is the same either way. Worth verifying against Vercel docs as part of the P1.1 remediation.
- **Vercel Firewall free-tier capabilities.** The brainstorm and admin doc both speculate that per-IP rate-limit rules may not be available on the free tier. P1.3's fix (in-app fallback) is unconditional and removes the dependency on this question. P2.2's fix (IaC script) presumes the rules are available; if they're not, P2.2 collapses to "ship the in-app fallback only."
- **M2.5 demo-bot scope.** Treated as a Travis-side operator follow-up that doesn't affect this PR's correctness. If demo bots are required for the viewer to be visibly correct (empty canvas otherwise looks broken on first impression), P2.13 escalates toward P1.
- **The `/api/v1/public/...` namespace as the long-term bot read path.** P2.10 assumes the public endpoints are a "viewer-only" surface that gets duplicated to authenticated bots. If the intent is "public is the bot path long-term," P2.10 collapses to "document that decision and add ETag to the authenticated chunk endpoint" — much smaller fix.

## References

- Source brainstorm: [`plans/brainstorms/2026-05-09-m2-public-viewer.md`](../brainstorms/2026-05-09-m2-public-viewer.md) (on `plan/m2-public-viewer-brainstorm`).
- Source requirement: [`plans/requirements/requirement-20260509-1711-milestone-2-public-viewer.md`](../requirements/requirement-20260509-1711-milestone-2-public-viewer.md) (on `plan/m2-public-viewer-brainstorm`).
- M1 implementation review (precedent format): [`plans/reviews/review-20260508-1822-m1-implementation-code.md`](review-20260508-1822-m1-implementation-code.md).
- M1 polish requirement (precedent for "themed P2 follow-up PR"): [`plans/requirements/requirement-20260508-1900-m1-polish-and-defense-in-depth.md`](../requirements/requirement-20260508-1900-m1-polish-and-defense-in-depth.md).
- Per-reviewer raw outputs: were written to `/tmp/m2-review/reviewer-*.md` during synthesis; cleaned up after this artifact was persisted.

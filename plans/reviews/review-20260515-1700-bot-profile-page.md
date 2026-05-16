# Bot profile page review — multi-reviewer synthesis

**Reviewed:** [PR #29](https://github.com/travisfischer/botplace/pull/29) — branch `feat/bot-profile-page`. Net ~880 LOC across 10 files: new `/bots/<handle>` SSR'd page + activity-feed client component, `?before=<iso>` cursor + `palette_version` per row on the events API, viewer pixel-inspect URL swap, 7 new reserved handles, hosted docs + probe doc.
**Requirement:** [`requirement-20260515-1635-bot-profile-page.md`](../requirements/requirement-20260515-1635-bot-profile-page.md) (status `draft`).
**Reviewer set:** 9 principle reviewers — 7 `how-we-build/*` + 2 `core/*`. **Skipped**: `how-we-build/{cloud-coding, compound-engineering, prompt-and-eval-lifecycle, sacred-schema}` and `core/{autonomous-learning, llm-model-fluid, universal-evals}`. No infra, no eval loops, no prompts, no LLM, and no schema migration in this PR.
**Date:** 2026-05-15.

## Verdict

**One P1 finding.** The page does a direct Prisma query for the initial events batch that's nearly identical to what the events API route does — same workflow, same shape, two copies. Extract a shared `loadBotInitialEvents` helper before merge so a future change to either side doesn't silently diverge.

P2 batch (8 items) is mostly small + worth landing in this PR: a duplicated `formatRelative` helper across 3 files, missing IP rate-limit on the page route, latent silent-failure in the load-more palette fetch, hardcoded "sector-1" fallback that breaks the day a second sector ships, missing Rollback section in the requirement, missing pre-merge SQL probe verifying no production bot owns one of the 7 newly-reserved handles, plus untested page + activity-feed behavior. None individually requires a redesign; together they're the same "polish before ship" batch the previous two reviews produced.

Three reviewers came back clean (`goldilocks-scoping`, `core/markdown-everything`, `how-we-build/agent-native` essentially clean), confirming the shape of the work is right — the gaps are seams, not architecture.

## Reviewer outputs

| Reviewer | P1 | P2 | P3 | Verdict |
|---|---|---|---|---|
| how-we-build/agent-native | 0 | 0 | 1 | Clean — human page over agent-accessible APIs |
| how-we-build/coding-agent-plurality | 1 | 1 | 1 | Forked events query — shared helper needed |
| how-we-build/quality-first | 2 (downranked to 1 P2) | 3 | 1 | Test coverage + latent silent-failure |
| how-we-build/security-and-privacy | 0 | 1 | 4 | Page route lacks IP rate-limit |
| how-we-build/goldilocks-scoping | 0 | 0 | 1 | "Just right" — speculative palette-fetch loop noted |
| how-we-build/observability-and-incidents | 0 | 1 (must-fix) | 2 | Pre-merge reserved-handle SQL probe |
| how-we-build/release-and-rollout | 0 | 1 | 0 | Missing Rollback section (same gap as prior PR) |
| core/markdown-everything | 0 | 0 | 0 | Clean |
| core/agent-native | 0 | 0 | 3 | Pass with doc-polish nits |

**Synthesizer re-ranking:**
- Quality-first's P1 on the silent palette-fetch `Promise.all` failure: **dropped to P2**. The bug is real but latent — palette_version is always `1` today and no v2 exists. Fix is one line (per-promise catch) but doesn't block ship.
- Quality-first's P1 on zero automated tests for the page: **dropped to P2**. The requirement explicitly punted page tests to manual probes; the activity-feed component's load-more logic IS testable in isolation but that's an improvement, not a regression. Previous PRs' quality-first P1s were about security-load-bearing audit log shape; this one is UI state. Different stakes.

---

## P1 — ship blocker

### P1.1 — Initial-events query forked between page and events API route

**Reviewer:** how-we-build/coding-agent-plurality.
**Evidence:** `app/bots/[handle]/page.tsx:58-78` does a direct `prisma.pixelEvent.findMany` with the same `where: { botId }`, same `orderBy: { createdAt: "desc" }`, same `take: 20`, nearly-identical `select` list, and nearly-identical wire-shape mapping as `app/api/v1/public/bots/[handle]/events/route.ts:182-229`. The page also does a redundant `prisma.bot.findUnique` for `id` because `getBotPublicDetail` deliberately discards it.

**Why this blocks ship:** the events API will evolve — future moderation policies, filter logic, or shape changes will land in the API route. The page silently keeps the old shape. The same shared-core/thin-adapter discipline the previous features upheld (`validateComment` / `updateBotDescription` / `getBotPublicDetail`) calls for one source of truth here too.

**Fix:** extract a `loadBotInitialEvents({ handle, limit })` helper into `src/bots/` that:
1. Looks up the bot by handle (returns null if absent).
2. Pulls the first N events, ordered desc by createdAt.
3. Applies the `commentsDisabled()` gate before returning.
4. Returns the wire shape (or a `BotEvent` type the API route's `toWire` can serialize).

Page calls the helper directly; events API route calls the same helper and serializes via `toWire`. ~40 lines moved + ~10 lines deleted from each call site.

---

## P2 — strong recommend before merge

### P2.1 — `formatRelative` duplicated in 3 places

**Reviewer:** how-we-build/coding-agent-plurality.
**Evidence:** Byte-identical helper at `app/bots/[handle]/page.tsx:172-187` and `app/bots/[handle]/_activity-feed.tsx:223-238`. A third near-copy (`formatRelativeTime`) at `src/viewer/pixel-inspect.tsx:243`. The server/client split is not a real reason to fork a pure function — pure formatters work in both contexts.

**Fix:** extract to `lib/format-relative.ts`. Import from all three. ~15 lines moved + duplicates deleted.

### P2.2 — Page route has no IP rate-limit

**Reviewer:** how-we-build/security-and-privacy.
**Evidence:** `app/bots/[handle]/page.tsx` does 2 indexed Prisma queries per page-view (bot lookup + events query) with `dynamic = "force-dynamic"` (no SSG cache, every request hits the server). The sibling events API route IS rate-limited via `checkPublicReadRateLimit` (`route.ts:103`). The page route is not — no `middleware.ts`, no `next.config` header rule, no `vercel.json` rule.

**Why this matters:** SSR page = more server work per view than the JSON API. If the page becomes a scraping target, it's the most expensive surface on the app with no per-IP throttle.

**Fix:** call `checkPublicReadRateLimit(clientIpFrom(request))` at the top of the page render. The module is already imported on the API route; pull it into the page. The page can render a "rate-limited" message on 429 (or just call `notFound()` — degraded UX is acceptable for an unusual flood).

### P2.3 — Silent failure in load-more palette fetch

**Reviewer:** how-we-build/quality-first (downranked from P1).
**Evidence:** `app/bots/[handle]/_activity-feed.tsx:77-89` uses `Promise.all` to fetch missing palettes. No per-promise catch. If ONE palette fetch rejects, the whole batch promise rejects — but `setEvents` already committed the new events before that happens. The user sees "Failed to load more (HTTP …)" while the new events are visibly present in the feed. Latent today (palette_version is always 1) but lights up the moment palette v2 ships.

**Fix:** wrap each palette fetch in its own try/catch. Missing palettes show `#cccccc` (the existing fallback at `_activity-feed.tsx:140`). One palette failure → one row's swatch is gray, rest of the feed works.

### P2.4 — Hardcoded "sector-1" fallback for the View-canvas link

**Reviewer:** how-we-build/quality-first.
**Evidence:** `app/bots/[handle]/page.tsx:110` — `<Link href="/sectors/${feedEvents[0]?.sector_id ?? "sector-1"}">View canvas</Link>`. Correct today (only sector-1 exists in prod). Wrong the day a second sector ships.

**Fix:** drop the link entirely when `feedEvents.length === 0`, or link to `/sectors` (an index page that doesn't exist yet) and let M4-ish sector listing land separately. Either way, kill the hardcoded sector id.

### P2.5 — `parseBefore` silently falls through on garbage input

**Reviewer:** how-we-build/quality-first + how-we-build/security-and-privacy (overlapping).
**Evidence:** `app/api/v1/public/bots/[handle]/events/route.ts:55-67` — `parseBefore` returns `null` on `NaN` Date.parse, which becomes "no filter" downstream. Same shape as the existing `parseSince`, so it's consistent — but the route's OWN justification for the mutual-exclusion 400 ("a silent precedence rule would mask it") argues for tightening this case too.

**Fix:** if `parseBefore` returns null AND `raw !== null`, return 400 `invalid_input` with `field: "before"`, `reason: "before_invalid"`. Same fix recommended for `?since=` (separate PR) to keep the contract consistent.

### P2.6 — Missing Rollback section in the requirement

**Reviewer:** how-we-build/release-and-rollout.
**Evidence:** Same gap the prior bot-pixel-comments review (P2.6) caught. `plans/requirements/requirement-20260515-1635-bot-profile-page.md` ends at "Open questions" → "Next steps" without a Rollback runbook. The shape is short (pure code revert, no DB cleanup, reserved-handle expansion is safely one-way) but should still be explicit.

**Fix:** add a 4-line Rollback section. Suggested text in the reviewer file.

### P2.7 — No pre-merge SQL probe verifying no production bot owns the 7 new reserved handles

**Reviewer:** how-we-build/observability-and-incidents (flagged as must-fix).
**Evidence:** Probe 19 in `docs/dev/probes/bot-profile-page.md` checks **post-deploy** that any production bot with one of the 7 new names still resolves. The reviewer's point: "fast detection and containment" wants the answer **before** merge — if a bot DOES own one of those handles, a future `app/bots/new/page.tsx` static route would shadow them.

**Fix:** add a pre-merge probe row with the SQL: `SELECT handle FROM bots WHERE handle IN ('new', 'edit', 'create', 'settings', 'profile', 'manage', 'account')` against `$PROD_DATABASE_URL`. Expected result: empty set. If non-empty, the reservation list needs a different defensive strategy.

### P2.8 — `hasMore` exactly-20-event boundary not pinned by a test

**Reviewer:** how-we-build/quality-first.
**Evidence:** `app/bots/[handle]/_activity-feed.tsx:40-42` initializes `hasMore` based on whether the initial batch was full. A bot with exactly 20 events triggers `hasMore = true` (correct), but the first Load-more returns `[]` (the API returns events older than the cursor; nothing exists). The flow gracefully sets `hasMore = false` on the empty response — but no test asserts this. Easy to regress.

**Fix:** add a test (component-level or via the events API route directly) that confirms `hasMore` flips false on an empty subsequent batch.

---

## P3 — defer

All real but small. Reasonable to defer to a follow-up cleanup PR.

- **P3.1** — Page reaches past its own public events API and re-implements the wire shape via direct Prisma. Same root as P1.1; folded in. (how-we-build/agent-native)
- **P3.2** — `parseBefore` is a verbatim clone of `parseSince` in the same route file. Within-file duplication, not portability-affecting. (coding-agent-plurality)
- **P3.3** — `palette_version` integration test asserts `=== 1` on a fresh write. Would also pass if `toWire` hardcoded `palette_version: 1`. Strengthen by seeding a row with explicit `paletteVersion: 2` via Prisma directly. (quality-first)
- **P3.4** — Zero-width chars / bidi controls (U+202E etc.) survive in stored description + comment. The page renders with `whiteSpace: "pre-wrap"`, so they flow to the DOM. Cosmetic at worst on a flat bio; not a Trojan-Source vector since the page doesn't render code. (security)
- **P3.5** — `last_seen_at` + per-event `accepted_at` build a precise activity timeline. Consistent with the "canvas is public" principle; compounding a P3 from the descriptions review. (security)
- **P3.6** — Reserved-handle expansion isn't enforced against existing prod rows (this is the same concern P2.7 addresses with a probe). (security)
- **P3.7** — Speculative palette-fetch-on-load-more code in the activity feed is ~20 lines for a path that's unreachable today (palette_version always 1). Could be a TODO. (goldilocks-scoping)
- **P3.8** — SSR page does Prisma queries with no log line / request_id / latency. Pre-existing convention (all `app/*/page.tsx` are silent); flag for a future cross-cutting milestone, not this PR. (observability)
- **P3.9** — `?before=` cursor not in log fields. Pagination incidents can't distinguish forward vs backward cursor users. Suggest adding `cursor_direction: "before" | "since" | "none"` to the events route's log line. (observability)
- **P3.10** — `notFound()` from the page is silent. Sibling API path logs `bot_known: false`. Optional symmetry. (observability)
- **P3.11** — `agents.ts` doesn't include a "paginate-until-empty" idiom for `?before=`. One-paragraph addition. (core/agent-native)
- **P3.12** — `palette_version` rationale is a single buried sentence in `api.ts`. State the wrong-color-after-palette-roll failure mode more prominently for replay agents. (core/agent-native)
- **P3.13** — `agents.ts:116` states `before`/`since` mutual exclusion in prose but doesn't include the error slug. Context-tight agents grounding only on `agents.md` would benefit. (core/agent-native)

---

## Cross-cutting themes

1. **Shared-core discipline lapsed.** Three findings (P1.1, P2.1, P3.2) all stem from the same shape: code that has a one-call-site analog elsewhere in the codebase, copied rather than imported. The previous two reviews' P2.8 (rejection→HTTP mapping) was similar shape; the `invalidInputResponse` helper from that PR is exactly the pattern this one needs more of. Worth a sweep.

2. **Page route observability is silent across the project.** Two reviewers flagged this. Convention is "SSR routes rely on Vercel access logs." Pre-existing — but the new page is a meaningful new SSR surface, so the gap is widening. A small `app/*/page.tsx` logging pattern would land cleanly in a sibling PR.

3. **Latent edge cases live in the feature flag / forward-looking code paths.** Both the palette-fetch silent failure (P2.3) and the `palette_version` test (P3.3) are unreachable today because palette v2 doesn't exist. Each one is small but the cluster argues for either (a) shipping v2 with the polish PR that fixes them, or (b) pruning the speculative code to a TODO until v2 is on the roadmap (the goldilocks reviewer's suggestion).

4. **Rollback section is a recurring miss.** Third PR in a row to ship without one in the requirement. Worth adding a checklist item to the requirement template or the open-pr workflow.

5. **Three reviewers came back fully clean.** Goldilocks-scoping called the feature "just right," markdown-everything found no doc-discipline gaps, and the human-facing-page nature meant agent-native (the how-we-build flavor) had little to chew on. The feature's shape is well-bounded.

---

## Action plan

**Pre-merge (P1 fix — required):**

1. Extract `loadBotInitialEvents` shared helper into `src/bots/`. Page + events API route both consume it. *(P1.1; ~30 min.)*

**Recommended before merge (P2 batch):**

2. Extract `formatRelative` to `lib/format-relative.ts`. Three call sites import from there. *(P2.1; ~10 min.)*
3. Add `checkPublicReadRateLimit` to the page route. *(P2.2; ~10 min.)*
4. Wrap palette-fetch in per-promise try/catch in `_activity-feed.tsx`. *(P2.3; ~5 min.)*
5. Replace the hardcoded "sector-1" fallback with a no-link-when-empty UX. *(P2.4; ~3 min.)*
6. Tighten `parseBefore` to 400 on garbage input. *(P2.5; ~5 min.)*
7. Add Rollback section to the requirement. *(P2.6; ~5 min.)*
8. Add a pre-merge SQL probe row to the probe doc. *(P2.7; ~3 min.)*
9. Add an `hasMore` boundary test. *(P2.8; ~10 min.)*

**Defer (all P3s):** small polish items, fine for a sibling cleanup PR.

**Post-deploy:**

10. Run pre-merge probes 1–16 against preview (browser-required for page rendering).
11. Squash-merge.
12. Run post-deploy probes 17–19 (now 20 after P2.7 lands a SQL row).
13. Flip requirement `status: shipped` + add `shipped: <YYYY-MM-DD>`.

---

## References

- Requirement: [`plans/requirements/requirement-20260515-1635-bot-profile-page.md`](../requirements/requirement-20260515-1635-bot-profile-page.md)
- Probe doc: [`docs/dev/probes/bot-profile-page.md`](../../docs/dev/probes/bot-profile-page.md)
- Sibling reviews: [`review-20260515-1244-bot-descriptions.md`](review-20260515-1244-bot-descriptions.md), [`review-20260515-1523-bot-pixel-comments.md`](review-20260515-1523-bot-pixel-comments.md)
- Reviewer outputs (temporary): `/tmp/botplace-review-profile-page/reviewer-*.md` (cleaned up post-synthesis)

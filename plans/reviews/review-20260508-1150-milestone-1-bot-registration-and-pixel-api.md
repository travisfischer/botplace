---
date: 2026-05-08
type: review
target: plans/requirements/requirement-20260508-1121-milestone-1-bot-registration-and-pixel-api.md
status: addressed
recommendation: address P1 blockers and the strongest P2 themes before flipping the requirement to ratified
---

> **Resolution (2026-05-09).** The M1 requirement was revised pre-implementation to fold in P1 + the strongest P2 themes (see the requirement's revision note). M1 itself shipped in [PR #7](https://github.com/travisfischer/botplace/pull/7), and the consensus P2s carved out of the [implementation review](review-20260508-1822-m1-implementation-code.md) shipped in [PR #8](https://github.com/travisfischer/botplace/pull/8). Per-item Developer Decisions inline below remain accurate.

# Review: Milestone 1 — Bot Registration, Pixel API, and Event Log

## Conventions

Each actionable finding (and each P2 theme) is followed by a **Developer Decision:** block where the developer records their response. Format: a short verb (`accept` / `modify` / `reject` / `defer`) plus one-line rationale, optionally followed by notes. Empty blocks are pending decisions. This is a Botplace-local convention proposed for upstream agent-engineering — it makes a review file a two-sided artifact (reviewer findings + author decisions), so the "what did we do about this?" history lives next to the finding instead of in a separate PR description.

## Verdict

**Not ready to start.** The requirement document is well-structured and substantively sound — strong on schema intent, security framing for API keys, and explicit deferrals — but seven P1 findings cluster around three themes that the doc cannot ship without addressing: **owner-side agent parity** (the project's own agent-native principle is violated by the UI-only bot management surface), **bootstrap/secrets contract regressions** (M1 introduces dependencies that break the one-command-bootstrap property M0 just shipped), and **operational readiness gaps** (no rollback, no staged rollout, no structured-log contract, no explicit Prisma schema).

The recommendation is to fix the P1 blockers and the strongest P2 themes (testability of acceptance criteria, scope trims), then re-run targeted reviewers (sacred-schema, observability, release-and-rollout, both agent-native) before kickoff. The cleanup is meaningful but not large — most fixes are doc-only and the longest single change is adding owner-scoped HTTP endpoints + script wrappers.

## Reviewer summary

16 principle reviewers ran in parallel (full registry, no exclusions per `review.local.md`). Aggregate counts:

- **P1 (blocker):** 7
- **P2 (important):** 22
- **P3 (nice-to-have):** 22

12 reviewers produced findings; 4 cleanly returned no-findings statements (`prompt-and-eval-lifecycle`, `autonomous-learning`, `llm-model-fluid`, `universal-evals`) — those principles target LLM-driven server-side functionality, which M1 deliberately does not have. They become applicable starting at M3 (agent-author bundles, MCP wrappers).

Per-reviewer raw outputs are at `/tmp/botplace-review-20260508-1121/reviewer-*.md` during this run; cleaned up after this synthesis lands.

---

## P1 blockers (must address before implementation starts)

### B1. Owner bot management is UI-only — violates the project's own agent-native principle

**Sources:** `how-we-build-agent-native` finding 1, `core-principles-agent-native` finding 1, `how-we-build-cloud-coding` finding 3.

The requirement carefully gives every *operator* action both an HTTP endpoint and a `pnpm` script wrapper (lines 32, 72–75) — exactly the agent-native shape. The parallel set of *owner* actions — sign in, create a bot, list bots, mint/rotate/revoke a key — is described only as "Owner-facing bot management UI" at `/bots` (line 35, lines 55–59). There is no documented `POST /api/v1/bots`, no `pnpm` script, and no machine-friendly auth path. Combined with the explicit note that "preview deploys cannot complete OAuth" (line 114), an agent working on a PR preview cannot exercise its own change end-to-end.

This is a direct contradiction of [`docs/design/principles.md` line 14](../../docs/design/principles.md): "UI-only operator features are a regression and should be flagged in review." The owner persona is the canonical Botplace user (a developer who runs a fleet of bots), and the doc gives them no agent path.

**Fix:** add owner-scoped HTTP endpoints behind the Auth.js session (`POST /api/v1/bots`, `GET /api/v1/bots`, `POST /api/v1/bots/:id/keys`, `DELETE /api/v1/bots/:id/keys/:key_id`) plus a personal-access-token affordance — one-time human OAuth, then a long-lived owner-scoped token an agent can hold. The `/bots` UI becomes a thin client of those endpoints. Add `pnpm` script wrappers for parity with the admin set. This also resolves the preview-OAuth blocker because preview agents can mint synthetic test bots without a browser.

**Developer Decision:** Yes. We should be fully agent native and as such I like this fix.

### B2. Bootstrap regression — `BOTPLACE_API_KEY_PEPPER` is required at startup but excluded from `.env`

**Source:** `how-we-build-cloud-coding` finding 1.

The doc has an internal contradiction: line 118 says the pepper is "added to `pnpm env:check`'s required-list and to the bootstrap allow-list; the auth path refuses to start with an empty pepper." Line 131 says "the local `.env` is **not** populated with this value by `pnpm db:bootstrap` — owners run with the production pepper from `op run`."

These cannot both be true. The first reads as "bootstrap materializes the pepper into `.env`"; the second reads as "bootstrap does not materialize the pepper, owners are expected to set it out-of-band." Either reading regresses the one-command-bootstrap property M0 + env-and-secrets-mvp shipped: a fresh clone + `pnpm db:bootstrap` no longer produces a runnable app.

**Fix:** pick one. Recommended path: generate a *disposable per-branch dev pepper* at bootstrap time and write it to `.env` alongside the other branch-local material — it is disposable since dev keys are signed against this dev pepper only and are themselves disposable. Production uses a different pepper held in Vercel project env + 1Password. Update line 118 and line 131 to match.

**Developer Decision:** Go with your recommendation here.

### B3. Upstash Redis credentials routed into `.env` — violates the secrets allow/deny list

**Source:** `how-we-build-cloud-coding` finding 2.

Line 127 says Upstash REST URL + token are "exported in `.env` only when bootstrapping a dev branch that needs Redis access." Upstash REST tokens are long-lived provider credentials; the [`docs/dev/secrets.md`](../../docs/dev/secrets.md) deny list explicitly forbids long-lived tokens in `.env` (only disposable branch-local connection material is allowed). M1 cannot ship by violating a contract that env-and-secrets-mvp just established.

**Fix:** treat Upstash creds the same way as `NEON_API_KEY`: process env only, populated by an external adapter (`op run`, cloud-agent platform secret, manual export). Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to `pnpm env:check`'s required-list and to `docs/dev/secrets.md`. Remove the "exported in `.env`" path from line 127. Optionally provision a disposable dev Upstash database for cloud agents whose creds can be rotated freely, but document it explicitly.

**Developer Decision:** yes, go with your recommendation as long as DX is smooth for both local devs and cloud agents.

### B4. No explicit schema artifact — Prisma model block, types, FKs, and cascade behavior all in prose

**Source:** `how-we-build-sacred-schema` finding 1.

The doc enumerates entities in prose (lines 24–29) and never commits to an explicit schema block. Decisions extremely expensive to reverse — `Sector.id` slug vs UUID, `BotApiKey.key_hash` `bytea` vs `text`, `PixelEvent.id` type, `onDelete` policy on every FK — are all left to the implementer at PR time, after which they become the de-facto contract. This is exactly the slow-down the sacred-schema principle is designed to force.

**Fix:** add a "Schema (proposed)" subsection under Scope with an actual Prisma model block for `Owner`, `Bot`, `BotApiKey`, `Sector`, `SectorChunk`, `PixelEvent`. Pin: column types, PK strategy, FK targets and `onDelete` policy, nullability, defaults, every `@unique` and composite-unique constraint, whether the chunk blob is `Bytes`/`bytea`. State rationale next to non-obvious choices.

**Developer Decision:** Yes, do it. define the schema for review.

### B5. `PixelEvent.bot_id` vs `api_key_id` ambiguity — audit trail durability at stake

**Source:** `how-we-build-sacred-schema` finding 2.

A `Bot` has multiple `BotApiKey` rows over its lifetime (line 24, line 59). `PixelEvent.bot_id` records only the bot, not the specific key. After a key rotation or any forensic question of the form "which credential wrote this pixel?", the event log cannot answer. Adding `api_key_id` later requires either a backfill or a non-trivial migration — and every consumer thereafter has to handle the nullable case forever.

**Fix:** record `api_key_id` on `PixelEvent` (with `bot_id` denormalized for query convenience or derived via FK). Costs nothing now; un-fixable later.

**Developer Decision:** Agreed.

### B6. No rollback / kill-switch / staged-rollout path for the public-write surface

**Source:** `how-we-build-release-and-rollout` findings 1 and 2.

M1 introduces the first publicly-callable write API plus persistent event-log + chunk state on `https://botplace.app/api/v1/pixels`. The doc never specifies how to disable writes (kill-switch), revert a bad release, or undo corrupting writes once events have accumulated. Per-bot revocation handles a misbehaving caller, not a misbehaving release of our own code. Validation Strategy is also one-shot launch — there's no allowlist, no soft-launch, no private-then-public phase.

**Fix:** add a kill-switch (env-flagged or admin-endpoint-flagged) that makes `POST /api/v1/pixels` return `503` immediately without touching DB or Redis, plus an acceptance criterion that flips it. Add a one-paragraph rollout subsection naming the phases (recommended minimum: ship behind a Google-`sub` allowlist, run validation against production, remove allowlist in a follow-up PR). Document the migration backout convention: forward-only, with the kill-switch + Neon point-in-time recovery as the recovery primitives.

**Developer Decision:**  We don't need this yet. Out of MVP scope.

### B7. No structured-log contract for write/auth path — defers M4 dashboards into impossibility

**Source:** `how-we-build-observability-and-incidents` finding 1.

Line 41 defers "Operator dashboards / structured logs / alerts beyond Vercel built-ins" to M4. Vercel built-ins only retain unstructured `console.log` text by default — meaning if M1 ships only ad-hoc string logs, M4 dashboards will have no historical signal to backfill from. The very events that motivate this milestone (auth failures, rate-limit denials, Redis-outage 503s, transaction failures) will not have stable fields to slice by. The principle is explicit that observability must be designed in, not bolted on later.

**Fix:** add one Non-Functional Requirement that locks in a minimum structured-log shape for `POST /api/v1/pixels` and the auth path — single JSON line per request with stable fields: `request_id`, `bot_id?`, `owner_id?`, `sector_id?`, `status`, `error_slug?`, `auth_failure_reason?` (internal only), `rate_limit_scope?`, `latency_ms`, `chunk_version_after?`, `dependency?` (e.g. `"upstash"` for Redis-outage 503s). No PII, no plaintext keys. Add `request_id` to the response body and to the `PixelEvent` row so HTTP/transaction/event-log are joinable on one ID.

**Developer Decision:**  Taht's fine. AS long as we keep it light and focused. I like establishing the convention.

---

## P2 themes (address during implementation)

The 22 P2 findings cluster into five themes. Each is a meaningful gap but not a blocker; consolidating fixes by theme keeps the requirement edit pass tractable.

### T1. Acceptance criteria are not actually testable

`how-we-build-quality-first` flags four:

- **Replay test (lines 100, 137)** is non-deterministic without pinning ordering (`PixelEvent.id` ASC during replay) and without freezing writes during snapshot. Last-write-wins makes it brittle otherwise.
- **p95 latency target (line 85)** has no measurement plan, no probe in Validation Strategy, no source of truth named (server-side timing? Vercel logs? end-to-end?). Aspirational rather than enforceable.
- **"Sufficient for a developer" (lines 33, 105)** is a subjective standard. Replace with a binary walkthrough — "fresh agent / second person reads docs/api/v1.md, posts a pixel and reads it back; zero clarifying questions during the walkthrough is the pass condition."
- **Redis fail-closed integration test** is named in the mitigation (line 111) but never promoted into Acceptance Criteria with CI enforcement. Same for the concurrency probe (line 141) — both are deterministic enough to be CI tests, not manual.

**Fix theme:** annotate every Validation Strategy bullet as `[CI]`, `[manual pre-release]`, or `[ad-hoc]`. Promote Redis fail-closed and concurrency to CI tests. Pin replay ordering. Replace subjective doc criteria with the walkthrough probe.

**Developer Decision:** Let's not overengineer quality at this phase. Let's think through MVP level (but yes reproducible/automatable quality checks). Balance "quality first" with super early MVP here.

### T2. Scope creep beyond the narrow problem

`how-we-build-goldilocks-scoping` flags six items that pre-build for problems M1 doesn't yet have:

- **Multi-sector runtime CRUD** (admin endpoint + script + acceptance test for `sector-2`). Keep `sector_id` columns and URL routing — that's cheap forward-compat. Drop the runtime sector-creation path; second sector is a future migration or a future admin endpoint.
- **Runtime-tunable rate limits** persisted to Postgres (line 74). With 1 token/60s and one operator, this is a pre-built lever for an abuse incident the milestone hasn't observed. Make rate limit a constant in `lib/rate-limit.ts`; defer runtime tuning to M4.
- **Chunk pre-allocation** (line 76 — 100 zeroed 10KB blobs at seed time). M1 explicitly excludes bulk chunk reads. Lazy-create chunk rows on first write; the single-pixel read endpoint already returns synthetic zero for never-written pixels per line 71.
- **Palette "versioned config module"** (line 30). `palette_version` column is fine; the registry-of-palettes scaffolding is design effort spent rationalizing a deferred feature. Ship a single hardcoded constant for `PALETTE_V1`; introduce the registry when `palette_version = 2` actually ships.
- **Owner-facing bot management UI** sits in tension with the M1 narrow problem ("an authenticated bot can write a pixel" — line 13, exit signal is `curl`). Either drop the UI for M1 in favor of `pnpm` scripts (matches CLI parity already established for ops endpoints), or keep UI but acknowledge the deliberate scope expansion. Note: this overlaps with B1 — the *fix* for B1 is HTTP endpoints + scripts, with the UI as a thin client. If you trim the UI further (defer "list" and "revoke" to a future iteration, keep only "create + reveal once"), the M1 atomic change unit gets meaningfully smaller.
- **Replay-test count of 1,000** at 1 token/60s is ~16.7 hours of wall-clock time per single-bot run. Either reduce to ~100 or define the multi-bot/multi-IP fan-out explicitly. As written, this acceptance criterion will silently slip.

**Fix theme:** trim the four scope items above (sector CRUD, runtime rate-limit knob, chunk pre-allocation, palette config module) — that's a meaningful reduction. Resize the replay test. Decide UI shape consistent with B1.

**Developer Decision:** Seems correct.

### T3. Bot-context primitives missing — agents can't reason about state

`core-principles-agent-native` flags three:

- **No `GET /api/v1/sectors/:id`** returning dimensions, palette, default color, chunk size. Bots have to hardcode `8 colors, 1000×1000` from `docs/api/v1.md`. When `palette_version = 2` ships, every existing bot silently mis-validates colors until updated.
- **No bulk chunk read** — agents wanting strategies like "paint near my existing pixels" or "avoid pixels other bots just touched" have no path except single-pixel GET in a loop. M1 strongly biases bots toward random-write strategies because that's the only thing the available primitives support.
- **Rate-limit state is opaque until 429.** Successful responses don't carry `X-RateLimit-Remaining-*` or reset headers, so agents must learn limits by failing.

**Fix theme:** add `GET /api/v1/sectors/:id` (~free given the schema). Add `GET /api/v1/sectors/:id/chunks/:chunk_x/:chunk_y` returning the packed binary blob + `chunk_version` (single-row read, separate rate-limit bucket; M2 viewer reuses the same primitive). Echo rate-limit headers on success and failure paths.

**Developer Decision:** Sure. This seems reasonable.

### T4. Security defense-in-depth gaps

`how-we-build-security-and-privacy` flags three P2s:

- **Static `ADMIN_TOKEN` lacks audit and least-privilege framing.** Add `AdminAuditEvent` table; require constant-time compare; document an admin-token rotation runbook in `docs/dev/secrets.md` even if rotation isn't routine; place admin endpoints under `/api/v1/admin/...` so edge/WAF rules can apply later.
- **`Owner.email` and `Owner.google_sub` PII boundary undeclared.** Classify as PII, never return outside the owner's own session, never log, reference owners by internal `Owner.id` in admin endpoints. Either add a minimal owner-delete path or note in Risks what the operator does if a deletion request arrives during the M1 window.
- **Rate-limit fail-closed scope is too narrow.** "Outage" can manifest as timeouts, malformed responses, SDK exceptions, or `success !== true` from Upstash. Tighten line 84: any non-OK return from the rate-limit module fails closed with `503`. Add a unit test for the malformed-response and SDK-exception cases, not just broken-host.

`how-we-build-observability-and-incidents` adds two P2s in this neighborhood:

- **No internal `auth_failure_reason` field** distinguishing `missing_header` / `malformed_header` / `unknown_key` / `revoked_key`. External response stays byte-identical; internal log differentiates.
- **No `AdminAuditEvent` row** for admin actions — the operator can't answer "who/when changed the rate-limit refill rate?" without it.

**Fix theme:** small NFR additions plus one new table (`AdminAuditEvent`). All consistent with the agent-native + observability fixes from B7.

**Developer Decision:** Yes. do it.

### T5. Compounding deliverables not named

`how-we-build-compound-engineering` flags two P2s:

- **No "Compound" step** at milestone close — the codified learnings, integration tests, and runbook stubs that M2 inherits are implicit. Concrete candidates already implied by the doc: the Redis fail-closed integration test (T1), the replay-script harness (T1), the pepper rotation runbook stub (B2), and the chunk-row schema + version field as M2's read contract.
- **Validation probes are described as one-shot manual exercises**, not committed scripts. The auth probe and concurrency probe in particular should be CI tests under a `pnpm test:integration` target.

**Fix theme:** add a "Compounding Outputs" or "Hand-off to M2" subsection naming the 3–5 concrete contracts M1 stabilizes (chunk row schema + version field, palette config, rate-limit module interface, event-log shape, sector URL routing). Promote committed-script primitives where the doc names manual probes.

**Developer Decision:** Dont' worry about this yet.

---

## P3 list (note for future, don't block kickoff)

22 P3s in total. Most are doc tightening or future-friendly nudges. Ones worth carrying into implementation:

- **API key prefix scheme** — `bp_live_<random>` is in Resolved Decisions; add an acceptance check that the prefix appears in the create response. (`how-we-build-security-and-privacy` adjacent.)
- **Constant-time comparison wording (line 81)** is technically inconsistent — DB index lookup isn't constant-time. Reword to clarify the HMAC is the timing-safe boundary; constant-time compare is unnecessary because there's no low-entropy secret to leak. (`how-we-build-security-and-privacy` finding 4.)
- **Empty-secret runtime guards** — generalize the pepper-empty check to also cover `ADMIN_TOKEN`, `AUTH_SECRET`, `GOOGLE_CLIENT_*`, `UPSTASH_REDIS_REST_*`. Single `assertSecretsPresent()` at boot. (`how-we-build-security-and-privacy` finding 6.)
- **Admin endpoint return-`404`-on-missing-token** so existence isn't advertised. (`how-we-build-security-and-privacy` finding 5.)
- **Tie-breaker rule for last-write-wins** — `PixelEvent.id` ASC during replay; `SELECT ... FOR UPDATE` already prevents same-`chunk_version` for two events. One-line addition. (`how-we-build-quality-first` finding 6.)
- **Index list at line 87 is incomplete** — add `Bot(owner_id)`, `BotApiKey(bot_id)`, `(sector_id, id)` on `PixelEvent` for deterministic replay, partial index on revoked keys. (`how-we-build-sacred-schema` finding 4.)
- **Chunk-size resize cost** — the doc calls it "no schema change," which understates a major data-migration event. Either move chunk size to a `Sector` column for per-sector resize, or rewrite the line to acknowledge the cost. (`how-we-build-sacred-schema` finding 6.)
- **Bot.status enum** — pin `Prisma enum BotStatus { ACTIVE REVOKED }` (recommended) rather than free-form text. (`how-we-build-sacred-schema` finding 8.)
- **Migration seeding mechanism** — pin "idempotent SQL inside the migration" + acceptance criterion confirming the seed survived. (`how-we-build-sacred-schema` finding 5.)
- **Shared admin-script helper** — consolidate `pnpm admin:*` wrappers through `scripts/admin/call.ts` so workflow logic doesn't fork. (`how-we-build-coding-agent-plurality` finding 1.)
- **Future-adapter contract** — extend the agent-native Resolved Decision: "all future agent-facing surfaces (MCP, per-platform skills, language SDKs) are thin wrappers over the documented HTTP API and add no business logic." (`how-we-build-coding-agent-plurality` finding 3.)
- **Probe artifacts as files** — each Validation Strategy probe leaves a short Markdown artifact under `docs/dev/probes/`. (`core-principles-markdown-everything` finding 4.)
- **Admin Markdown reference** — `docs/admin/v1.md` (or extended `docs/api/v1.md`) covering admin endpoints + script wrappers + env var requirements. (`core-principles-markdown-everything` finding 2.)
- **Runbook deltas as Acceptance Criteria** — promote line 114's `docs/dev/deploy.md` update from a risk-mitigation footnote to a checked deliverable. (`core-principles-markdown-everything` finding 3.)
- **Event-log JSONL export** as a Possible Future Enhancement bullet. Per `markdown-everything`, append-only logs are the canonical JSONL exception. Cheap future capability. (`core-principles-markdown-everything` finding 1.)
- **Acceptance check that admin endpoints have script wrappers** — convert the prose rule on line 75 into a CI lint. (`how-we-build-compound-engineering` finding 3.)
- **Mitigations name the revisit trigger** — every "document this" mitigation should also name the trigger that would cause us to reopen the decision. Makes the docs themselves Compound artifacts. (`how-we-build-compound-engineering` finding 4.)
- **Doc-walkthrough validation phrased agent-first**, not human-first. Small wording change with a real principle implication. (`core-principles-agent-native` finding 6.)

---

## Cross-reviewer agreement (signal worth weighting)

Three findings showed up under multiple reviewers — usually a sign that the gap is structural, not a single principle's quirk:

1. **Owner UI-only / no agent path** — flagged independently by `how-we-build-agent-native`, `core-principles-agent-native`, and `how-we-build-cloud-coding`. Highest cross-reviewer agreement in the set. **Promote to P1 → B1.**
2. **Manual probes that should be CI tests** — flagged by `how-we-build-quality-first`, `how-we-build-compound-engineering`, `how-we-build-release-and-rollout`. Three principles converge on the same gap. **Theme T1.**
3. **Missing structured-log shape pinned in M1** — flagged by `how-we-build-observability-and-incidents`, `how-we-build-release-and-rollout`. Two principles agree this is M1-load-bearing despite the M4 deferral on dashboards. **Promote to P1 → B7.**

---

## What "no findings" tells us

The four reviewers that returned no-findings statements (`prompt-and-eval-lifecycle`, `autonomous-learning`, `llm-model-fluid`, `universal-evals`) all target server-side LLM functionality. Their cleanly-empty reports confirm two things:

1. M1's scope-cuts are coherent — Botplace's *bots* may be LLM-driven, but the *server* is not, so these principles correctly do not apply.
2. M3 and beyond will re-trigger them. When agent-author bundles, MCP wrappers, or any LLM-backed feature lands in the Botplace server, prompt versioning, eval coverage, and model-swap discipline become live concerns. Worth pre-flagging in the brainstorm so it isn't a surprise then.

---

## Suggested next steps

1. **Edit-pass on the requirement** addressing B1–B7 and the strongest items in T1–T5. Most of these are doc-only and can land in a single PR. Estimated: half-day of focused editing.
2. **Re-run targeted reviewers** (`how-we-build-sacred-schema`, `how-we-build-observability-and-incidents`, `how-we-build-release-and-rollout`, `how-we-build-agent-native`, `core-principles-agent-native`) on the revised doc. Skip the four no-findings reviewers and the lighter-overlap ones to keep the second pass cheap.
3. **Flip status to `ratified`** in the requirement frontmatter once the second pass is clean.
4. **Then start implementation.** The implementation plan (M1 scope as written + the fixes above) can probably be split into ≥3 PRs: schema + auth + admin baseline; pixel write + rate limit + event log; owner-side endpoints + bot management surface.

The doc is closer than the P1 count suggests — the bones are good, the gaps are well-shaped. One focused edit-pass and a targeted re-review and M1 is ready to start.

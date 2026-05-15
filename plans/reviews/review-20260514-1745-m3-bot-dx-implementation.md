# M3 review — multi-reviewer synthesis (Bot DX implementation)

**Reviewed:** [feat/m3-bot-dx](https://github.com/travisfischer/botplace/tree/feat/m3-bot-dx) — 4 commits, 62 files, +5908 / −159 lines. M3 milestone implementing handle/display_name identity, three new public attribution endpoints, viewer click-to-inspect, hosted docs at `/build/*`, `/agents.md` aggregator, palette page, and API polish (X-Request-Id, per-field invalid_input, audit actor_kind).
**Requirement:** [`requirement-20260514-1530-milestone-3-bot-dx.md`](../requirements/requirement-20260514-1530-milestone-3-bot-dx.md).
**Implementer's solo synthesis:** [`review-20260514-1730-m3-bot-dx.md`](review-20260514-1730-m3-bot-dx.md).
**Reviewer set:** 16 default principle reviewers from the agent-engineering plugin's reviewer registry (11 `how-we-build` + 5 `core`). No specialist reviewers configured.
**Local config:** `review.local.md` says "Run all default principle reviewers from the registry." No includes / excludes.
**Date:** 2026-05-14.

This is the orchestrator-driven synthesis written **after** the implementer's solo review — independent reviewer subagents evaluated the diff against each principle in parallel; this artifact aggregates and prioritizes their findings.

## Verdict

**One P1 ship blocker.** The merge should not land until P1 is fixed. Several P2s should land alongside it (small fixes in the same window) or as an immediate follow-up PR.

The product surface — new endpoints, hosted docs, click-to-inspect, schema migration — is well-built. The blocker is a stale CLI script that the milestone scope didn't audit.

## Reviewer outputs

Each principle reviewer wrote a per-reviewer findings file with file:line evidence. Outputs synthesized below; no findings are dropped.

| Reviewer | P1 | P2 | P3 | Verdict |
|---|---|---|---|---|
| how-we-build/agent-native | 1 | 0 | 2 | One blocker |
| how-we-build/coding-agent-plurality | 0 | 1 | 2 | Mostly clean |
| how-we-build/cloud-coding | 0 | 0 | 1 | Effectively clean |
| how-we-build/compound-engineering | 0 | 0 | 1 | Effectively clean |
| how-we-build/goldilocks-scoping | 0 | 0 | 1 | Clean (well-scoped) |
| how-we-build/observability-and-incidents | 0 | 0 | 3 | Clean |
| how-we-build/prompt-and-eval-lifecycle | 1 (P2) | 1 | 1 | Eval-loop weak (see below) |
| how-we-build/quality-first | 0 | 0 | 3 | Clean |
| how-we-build/release-and-rollout | 0 | 2 | 1 | Rollout artifacts missing |
| how-we-build/sacred-schema | 0 | 2 | 1 | Schema convention drift |
| how-we-build/security-and-privacy | 0 | 0 | 3 | Clean |
| core/agent-native | 0 | 0 | 2 | Clean |
| core/autonomous-learning | 0 | 1 | 2 | Feedback loop incomplete |
| core/llm-model-fluid | 0 | 1 | 1 | Snippet rot risk |
| core/markdown-everything | 0 | 0 | 1 | Effectively clean |
| core/universal-evals | 0 | 1 | 1 | Same eval-loop gap |

---

## P1 — ship blockers

### P1.1 — `pnpm bot:create` is broken by the M3 schema change

**Reviewer:** how-we-build/agent-native
**Evidence:** `scripts/bots/create.sh:17` still posts `{"name":"<arg>"}`. The M3 endpoint at `app/api/v1/bots/route.ts:43-72` requires both `handle` and `display_name` and rejects requests missing them with `400 invalid_input field=handle reason=handle_required`.

**Why this blocks ship:** The repo's [`AGENTS.md`](../../AGENTS.md) principle is "every operator action has a CLI / MCP / HTTP path, never UI-only." The bot-create surface is operator-critical and the M3 milestone is *literally bot DX*. Shipping with the canonical CLI broken on the celebration milestone is the wrong shape.

**Verified scope:** Only `scripts/bots/create.sh` is affected. The other `scripts/bots/*` scripts (list, mint-key, revoke-key, rotate-key) operate on bot IDs and don't reference `name`. The implementer's `scripts/dev/seed-bot.mjs` already shows the right pattern (accepts `--handle`, falls back to `--bot-name` for back-compat).

**Suggested remediation:** Update `scripts/bots/create.sh` to accept `<handle> [display_name]` (defaulting `display_name` to `handle` when not provided). Pre-validate with the regex inline so curl errors are caught before they hit the server. Audit `docs/api/v1.md` for stale `pnpm bot:create` examples.

---

## P2 — strong recommend before merge

These are small enough to land in the same PR or an immediate follow-up. None are unsafe to ship without — but each erodes a downstream property the milestone claims (rollout safety, eval cadence, schema rigor, code reuse).

### P2.1 — Migration "operator pause between" pattern has no executable runbook

**Reviewer:** how-we-build/release-and-rollout (F1)
**Evidence:** Both `prisma/migrations/20260514160000_m3_bot_handle_add/migration.sql` and the [synthesis review](review-20260514-1730-m3-bot-dx.md) claim the migrations are split so an operator can pause and run probe 14 between step 1 and step 2 in production. But `prisma migrate deploy` runs every unapplied migration sequentially in one shot. There's no script, runbook step, or probe-doc instruction explaining how the operator actually achieves the pause.

**Suggested remediation:** Add a "Production rollout" section to `docs/dev/probes/m3-bot-dx.md` with the exact incantation (`prisma migrate deploy --to <migration-name>` or equivalent) for applying step 1 only, the wait for probe 14, then step 2. Without this, R1's mitigation is fictional.

### P2.2 — Hard-cut `bot_name` → `bot_handle` rename: "no external consumers" was asserted, not verified

**Reviewer:** how-we-build/release-and-rollout (F2)
**Evidence:** The pre-1.0-deprecation pattern was sold on "zero external consumers verified." No log-grep query, no Vercel-Firewall-rules audit, no checked artifact captures the verification.

**Suggested remediation:** Either (a) add a one-shot script + log query to `docs/dev/probes/m3-bot-dx.md` that confirms no external IP has hit `/events` and consumed `bot_name` in the last N days, or (b) downgrade the deprecation-pattern claim in the synthesis review to "no INTERNAL consumers verified; external consumers welcome to file an issue." Honesty about what was checked > confident-sounding mitigation.

### P2.3 — `AdminAuditEvent.actor_kind` enum values violate `SCREAMING_CASE` convention

**Reviewer:** how-we-build/sacred-schema (F1)
**Evidence:** `prisma/schema.prisma` has `BotStatus` (`ACTIVE`, `REVOKED`) and `BotRateTier` (`FREE`, `POWER`) — both SCREAMING_CASE. The new `AuditActorKind` shipped with `admin_token`, `seed_script`, `owner` (snake_case). Cheap to fix pre-merge; expensive to fix once production audit rows exist.

**Suggested remediation:** Rename to `ADMIN_TOKEN`, `SEED_SCRIPT`, `OWNER`. Update the migration, the enum declaration, and all four call sites. Do this BEFORE merging — once a single prod audit row exists with `admin_token`, the rename becomes a real migration with downtime risk.

### P2.4 — Migration step 1 has no preflight collision check

**Reviewer:** how-we-build/sacred-schema (F2), how-we-build/quality-first (F3)
**Evidence:** `prisma/migrations/20260514160000_m3_bot_handle_add/migration.sql:21-31` acknowledges that two pre-existing bots could collide on the new `handle` global-uniqueness index, then proceeds to `UPDATE ... SET handle = name` and immediately tries to add `bots_handle_key`. If a collision exists, the migration aborts mid-state (column added, index missing).

**Suggested remediation:** Prepend a `DO $$ ... HAVING count(*) > 1 ... RAISE EXCEPTION` block, OR a deterministic dedupe (e.g. append the bot id suffix on collision). For the documented production state (3 launch bots, no overlap), this is theoretical — but the migration is permanent infrastructure.

### P2.5 — Probe 15 (the LLM-agent end-to-end exit signal) isn't a re-runnable eval

**Reviewers:** how-we-build/prompt-and-eval-lifecycle (F1), core/autonomous-learning (F1), core/universal-evals (F1)
**Evidence:** `docs/dev/probes/m3-bot-dx.md:373-415` defines probe 15 as a single human+stopwatch session with subjective pass criteria, no fixed task corpus, no scorecard, no machine-readable output, no pinned model. Three reviewers flagged the same gap from different angles: prompt-eval lifecycle (no regression detection), autonomous-learning (no captured trace for iteration), universal-evals (no eval coverage for the LLM-facing surface).

**Suggested remediation:** Land an `evals/agents-md/` corpus + `pnpm eval:agents-md` runner that:
1. Pins a model (e.g. `claude-haiku-5` AND `claude-sonnet-5`).
2. Runs N frozen bot specs against `/agents.md`.
3. Verifies completion via the public attribution endpoint (probe 3 already does the read).
4. Emits JSONL with `{task, model, agents_md_sha, elapsed_s, pass, transcript_path}` so iteration N+1 can compare against N.

This isn't M3-blocking — but flag it explicitly as the M3.5 / M4 prereq, otherwise probe 15 becomes a perpetually-deferred ritual.

### P2.6 — Hybrid LLM-strategy snippets pin floating model IDs without rot detection

**Reviewers:** how-we-build/prompt-and-eval-lifecycle (F2), core/llm-model-fluid (F1)
**Evidence:** `src/build-docs/content/patterns.ts:340,361,379` ships `claude-haiku-5`, `anthropic/claude-haiku-5`, and `gpt-4o-mini` as recommended snippets. These propagate verbatim into N third-party bots; when providers retire models, those bots silently rot. The principle's "tier labels as functional roles" anti-pattern.

**Suggested remediation:** Either (a) replace literals with env-var indirection (`process.env.MODEL ?? "claude-haiku-5"`) + a single "providers rotate; check current model names with your provider" callout above the gallery, or (b) annotate each snippet with `// Model name as of 2026-05-14; check provider docs before use`.

### P2.7 — P2002 unique-violation classification duplicated across HTTP route + server action

**Reviewer:** how-we-build/coding-agent-plurality (F1)
**Evidence:** `app/api/v1/bots/route.ts:103-158` and `app/bots/_actions.ts:95-124` both classify Prisma's P2002 unique-violation by inspecting `meta.target` to decide between `handle_taken` vs `display_name_taken`. Identical logic, two locations.

**Suggested remediation:** Move into `src/bots/index.ts` as a `BotUniqueConflictError` (typed) or a `classifyBotUniqueViolation(err): "handle_taken" | "display_name_taken" | null` helper. Adapters re-throw the typed error or map the slug — not duplicate the logic.

---

## P3 — defer to follow-ups

Listed compactly. Each came from a single reviewer; none are individually critical.

| ID | Reviewer | Finding |
|---|---|---|
| P3.1 | how-we-build/agent-native | `?format=md` query parameter named in requirement; shipped as separate `/api/build-md/<slug>` endpoint instead. Already noted in implementer's review as a deviation. |
| P3.2 | how-we-build/agent-native | Click-to-inspect "see recent activity" → raw JSON tab. Already on the implementer's follow-up list. |
| P3.3 | how-we-build/coding-agent-plurality | `pepperOrDie()` in `app/bots/_actions.ts:44` shadows `requirePepper()` in `lib/route-helpers.ts:141` with divergent failure modes. Unify on the typed helper. |
| P3.4 | how-we-build/coding-agent-plurality | Handle regex hard-coded in `src/build-docs/content/api.ts:129` while canonical is `src/bots/handle.ts:18`. Interpolate `HANDLE_REGEX.source` into the markdown content to avoid drift. |
| P3.5 | how-we-build/cloud-coding | `scripts/dev/seed-bot.mjs:13-14` doc header still shows `--bot-name` example; update to `--handle`. |
| P3.6 | how-we-build/compound-engineering | Requirement flipped to `status: shipped` but probe 15 (the explicit exit criterion) hasn't run. Either keep at `ready` or add `exit_probe_status: pending` sibling. Honesty about what's been verified. |
| P3.7 | how-we-build/observability | `app/api/v1/public/sectors/[id]/events/route.ts:232` 500 path drops `rlHeaders` — asymmetric vs sibling 500 handlers. |
| P3.8 | how-we-build/observability | `publicReadRateLimitResponse` 429/503 paths emit `request_id` in body but no `X-Request-Id` header. Pre-existing but M3 widens the surface. |
| P3.9 | how-we-build/observability | `error_class` and `source_ip` ride `LogFields`'s `[key: string]: unknown` escape hatch instead of being declared. Promote to typed fields. |
| P3.10 | how-we-build/quality-first | `?since` filter on `/api/v1/public/bots/:handle/events` is documented but not asserted in `tests/api/m3-attribution-endpoints.test.ts`. Add one case. |
| P3.11 | how-we-build/quality-first | `src/viewer/pixel-inspect.tsx` (238 lines) has no direct unit tests. Click-outside / Esc / relative-time logic relies on probe 12 manual verification only. |
| P3.12 | how-we-build/release-and-rollout | Step 2 `DROP COLUMN "name"` acknowledged irreversible; no rollback path (Neon PITR + redeploy at pre-M3 SHA) documented anywhere. |
| P3.13 | how-we-build/sacred-schema | `handle` column is unbounded `TEXT` while app-code regex caps at 32. No DB-level `CHECK` constraint. Defense in depth. |
| P3.14 | how-we-build/security-and-privacy | `m25-` handle prefix bypasses `validateHandle` at `app/api/v1/public/bots/[handle]/events/route.ts:96` via a `startsWith` shortcut. Use `validateHandle(handle, { enforceProtectedPrefixes: false })` for consistency. |
| P3.15 | how-we-build/security-and-privacy | Reserved-handle list in `src/bots/handle.ts:41-52` defends only the create path. If two owners predated the reserved-list addition, they'd retain reserved handles. Informational. |
| P3.16 | core/agent-native | Click-to-inspect button label promises "see recent activity" but destination is raw JSON. Either relabel or render in-place. |
| P3.17 | core/autonomous-learning | No structured intake channel for third-party bot authors to report doc confusion. R6 mitigation gap. |
| P3.18 | core/autonomous-learning | The three implementer deviations (MDX→strings, `?format=md`→endpoint, click-to-inspect→JSON) aren't lifted into "carries forward to M4 (MCP server)" priors. Loose lesson capture across milestones. |
| P3.19 | core/llm-model-fluid | SDK snippets (`patterns.ts:356,374`) are unversioned; `r.content[0].type === "text"` parse will break silently across SDK majors. |
| P3.20 | core/markdown-everything | Docs bodies live as JS template literals in `src/build-docs/content/*.ts` rather than `.md` sibling files. Forces backtick escaping; `find . -name '*.md'` over the docs surface returns nothing. The third option (raw `.md` imported as strings) wasn't considered. |
| P3.21 | core/universal-evals | Probe 15 names "Claude Code, Cursor, or ChatGPT" interchangeably with no version pin. Cannot distinguish prompt regression from upstream model change without a baseline. |

---

## Cross-cutting themes

Three patterns showed up in 3+ reviewers each — worth flagging to the next milestone's planning:

1. **Eval coverage for the LLM-facing artifact is the milestone's biggest unfinished business.** P2.5 + P2.6 + P3.21 are the same fundamental gap from three principle angles. The M3 *deliverable* is `/agents.md`; without an eval, every future edit is unverified. Recommend making "land an automated probe-15-equivalent" the M3.5 P0.

2. **Migration claims are stronger than the artifacts that back them.** P2.1 (no operator-pause runbook), P2.2 (no external-consumer verification), P3.6 (status flipped pre-probe), P3.12 (no rollback path), P2.4 (no preflight collision check). Each individually is small; together they suggest the synthesis review oversold rollout discipline.

3. **CLI surface wasn't audited for the schema break.** The P1 (`bot:create`) is the loud one; P3.5 (`seed-bot.mjs --bot-name` example) is the quiet adjacent. Suggest a follow-up sweep of `docs/api/v1.md` for stale `pnpm bot:*` examples post-merge.

## Open questions for Travis

1. **Should P2.3 (enum SCREAMING_CASE rename) land in this PR?** It's a real schema convention drift but adds a fourth migration. Either land it now (and re-verify probes 1, 13) or defer to a tiny follow-up PR before any operator script writes a `seed_script` row to prod.

2. **Should the requirement be flipped back to `ready` until probe 15 runs?** Per P3.6, the AGENTS.md convention says `shipped` means deployed. Pragmatically: shipping = merging + Vercel auto-deploy, but the *exit signal* is unrun. Honesty vs. friction trade-off.

3. **Are the M2.5 launch bots' production rows actually going to be backfilled cleanly?** P2.4 + the implementer's R1 mitigation both lean on this. Worth a probe 1 dry-run against a Neon branch cloned from prod-main BEFORE the deploy.

4. **Is the synthesis review at `review-20260514-1730-m3-bot-dx.md` superseded by this one?** Both reviews now exist. They serve different purposes (implementer's self-check + multi-reviewer synthesis), but a cross-link would help future readers know which is canonical.

## Action plan

**Land before merging this PR:**

- [ ] **P1.1:** Fix `scripts/bots/create.sh`. Update help string + `docs/api/v1.md` examples.
- [ ] **P2.3:** Rename `AuditActorKind` enum values to SCREAMING_CASE before any prod write happens. Adds a fourth migration; re-verify probes 1 + 13.

**Land in this PR if budget allows, otherwise immediate follow-up:**

- [ ] **P2.1:** Production rollout runbook in `docs/dev/probes/m3-bot-dx.md` for the migration-pause pattern.
- [ ] **P2.4:** Preflight collision check in migration step 1.
- [ ] **P2.7:** Move P2002 classification into `src/bots/index.ts`.
- [ ] **P3.5, P3.6:** doc nits.

**Defer to M3.5 / M4 prereq:**

- [ ] **P2.5:** Land an automated `pnpm eval:agents-md` so probe 15 is repeatable. Make this M3.5 P0.
- [ ] **P2.6:** Either env-var the model literals or add per-snippet date annotations.
- [ ] **P3.4, P3.20:** Docs source-of-truth tightening.

**Defer to M4 polish window:**

- All other P3s.

## References

- Reviewer outputs (temporary, cleaned up after this synthesis): `/tmp/m3-review-1778805857/reviewer-*.md`
- Reviewer registry: `${CLAUDE_PLUGIN_ROOT}/workflows/review/reviewers.md` (agent-engineering plugin v0.2.0)
- Output template: `${CLAUDE_PLUGIN_ROOT}/workflows/review/output-template.md`
- Local config: [`review.local.md`](../../review.local.md)
- Implementer's solo review: [`review-20260514-1730-m3-bot-dx.md`](review-20260514-1730-m3-bot-dx.md)
- Probe doc: [`docs/dev/probes/m3-bot-dx.md`](../../docs/dev/probes/m3-bot-dx.md)
- Follow-ups: [`m3-implementation-followups.md`](../follow-ups/m3-implementation-followups.md)
- Requirement: [`requirement-20260514-1530-milestone-3-bot-dx.md`](../requirements/requirement-20260514-1530-milestone-3-bot-dx.md)

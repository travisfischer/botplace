# Bot descriptions review — multi-reviewer synthesis

**Reviewed:** local working-tree implementation of the bot-descriptions feature on branch `claude/great-khayyam-07fd76`. ~990 LOC net across 27 changed files: `lib/moderation/` (new module), `src/bots/{display-name.ts,handle.ts,index.ts}`, `app/api/v1/bots/me/` (new) + `app/api/v1/public/bots/[handle_or_id]/` (new), `prisma/migrations/20260515120000_bot_description_add/`, owner UI editor at `/bots`, hosted-docs updates, 20-row probe doc, brainstorm + requirement.
**Requirement:** [`requirement-20260515-1155-bot-descriptions.md`](../requirements/requirement-20260515-1155-bot-descriptions.md) (status `draft`).
**Reviewer set:** 10 principle reviewers — 8 `how-we-build/*` + 2 `core/*`. **Skipped** (no scope here): `how-we-build/{cloud-coding, compound-engineering, prompt-and-eval-lifecycle}`, `core/{autonomous-learning, llm-model-fluid, universal-evals}` — this change has no infra, prompts, eval loops, or LLM functionality.
**Local config:** `review.local.md` ("run all default principle reviewers from the registry") — the skip set above is a one-off user instruction, not a config change.
**Date:** 2026-05-15.

## Verdict

**Three P1 findings.** Don't merge until they're addressed:

1. CI silently skips every route test for this feature (DB-gated, no DB in CI).
2. Content moderation pipeline is bypassed by zero-width characters, soft hyphens, and other Unicode format/punctuation between letters — a 60-second drive-by attack.
3. The hosted bot-author agent contract does not warn that descriptions are permanently public-attributed, leaving an LLM-agent author at risk of pasting owner identity / API-key fragments / other secrets.

The fixes for all three are small (≤ 1 paragraph or ≤ 5 lines of code each). The product surface itself — endpoints, shared-core boundary, schema migration, owner UI — is well-built; the P1s are seams the implementation glossed over, not architectural problems.

A larger P2 batch — most of it the same shape (the URL detector misses several scheme/IP forms; the rejection→HTTP mapping is duplicated across two adapters; release artifacts could be sturdier) — is well worth landing alongside the P1s or as an immediate follow-up.

## Reviewer outputs

| Reviewer | P1 | P2 | P3 | Verdict |
|---|---|---|---|---|
| how-we-build/agent-native | 0 | 1 | 0 | Owner-side edit is UI-only; missing PAT/CLI parity |
| how-we-build/coding-agent-plurality | 0 | 1 | 1 | Shared-core boundary solid; small duplication |
| how-we-build/quality-first | 1 | 1 | 2 | CI gap is the blocker |
| how-we-build/sacred-schema | 0 | 1 | 2 | Doc/migration type mismatch; otherwise clean |
| how-we-build/security-and-privacy | 2 (raised: 1) | 3 | 4 | Moderation bypasses + scunthorpe FP |
| how-we-build/goldilocks-scoping | 0 | 0 | 2 | Cleanest goldilocks-shaped feature in the project |
| how-we-build/observability-and-incidents | 0 | 2 | 3 | No path from rejection-log back to matched term |
| how-we-build/release-and-rollout | 2 (lowered: 0) | 3 | 2 | Rollback / kill-switch unset for UGC surface |
| core/agent-native | 1 | 2 | 2 | Privacy-warning gap in agents.md |
| core/markdown-everything | 0 | 2 | 2 | Requirement still `draft`; review not yet on disk |

**Synthesizer re-ranking notes:**
- One of security's two P1s (l33t-speak bypass) **dropped to P2** because requirement R2 explicitly accepts that limitation. The other (zero-width / non-letter separator bypass) **stays P1** because it's not what R2 had in mind — invisible-glyph bypasses display normal-looking offensive content to all viewers.
- Both of release-and-rollout's P1s **dropped to P2** because the migration is additive-nullable (rollback is mechanically `DROP COLUMN`, no data loss) and the requirement explicitly scoped out kill-switch. They remain real concerns; see P2.4 and P2.5.

---

## P1 — ship blockers

### P1.1 — CI workflow silently skips every new route test

**Reviewer:** how-we-build/quality-first.
**Evidence:** `.github/workflows/ci.yml:40-41` runs `pnpm test` against a runner that provisions no DB; `DATABASE_URL` is unset. Both `tests/api/bot-self-patch.test.ts:14-15` and `tests/api/public-bot-detail.test.ts:12-13` gate their entire `describe` block on `Boolean(process.env.DATABASE_URL)` via `describe.skip`. Result: 20 of the 50 tests added by this feature silently skip in CI. The merge gate verifies only the pure-function moderation + display-name layer (32 unit tests pass).

**Why this blocks ship:** quality-first standard #3 — verification is part of the work. CI's green status currently advertises coverage the runner never executed. This is a regression in signal honesty for a feature where the route handlers carry most of the user-facing risk (auth, moderation, response shape, rate-limit interaction).

**Fix options (pick one):**

- **(a) Provision Postgres in CI.** Add a `services: postgres` to the workflow, set `DATABASE_URL`, run migrations. Cost: ~30 lines of YAML. Unlocks the full route-test corpus for this feature AND every prior feature whose route tests were also silently skipping.
- **(b) Fail-closed on the skip.** Detect `CI=true`-but-`DATABASE_URL`-unset and throw at the top of the suite. Cost: 3 lines in `vitest.setup.ts`. Keeps the signal honest without provisioning infra. Doesn't actually run the tests, but stops pretending they're covered.

The reviewer recommends (a). I agree. Inherited problem from prior milestones, but this change inherits it cleanly: it's the first feature where every meaningful route is DB-gated.

### P1.2 — Deny-list bypass via zero-width characters, soft hyphens, and other Unicode format chars

**Reviewer:** how-we-build/security-and-privacy.
**Evidence:** `lib/moderation/normalize.ts:33-40` does NFKD → strip `\p{M}` (combining marks) → lowercase → collapse-runs. It does **not** strip `\p{Cf}` (Unicode format category), which includes:

- U+200B ZWSP (zero-width space)
- U+200C ZWNJ (zero-width non-joiner)
- U+200D ZWJ
- U+00AD soft hyphen
- U+FEFF BOM
- bidi format controls

Empirically confirmed by the reviewer against the live pipeline: `p<U+200B>o<U+200B>rn` renders as `porn` in every browser but normalizes to `p<U+200B>o<U+200B>rn` (the ZWSPs survive), and the `\bporn\b` deny-list regex does not match. Same outcome for ASCII separators between letters (`p.o.r.n`, `p-o-r-n`, `p_o_r_n`), which slip through because no step removes punctuation between letters either.

**Why this blocks ship:** the requirement's R2 acknowledges "a determined attacker will find bypasses" and frames the filter as low-effort. But the bypasses this allows are **invisible** — the rendered content reads normally, the deny list never fires. That's a display-vs-match desync that operators cannot detect by reading the canvas, which is the real failure mode. Slurs and explicit terms get to public-attribution UI through a fully obfuscated-on-the-wire payload.

**Fix:** in `lib/moderation/normalize.ts`, after NFKD + `\p{M}` strip, add a `\p{Cf}`-strip step:

```ts
.replace(/\p{M}+/gu, "")
.replace(/\p{Cf}+/gu, "")  // ← new line
.toLowerCase()
```

One line. Closes the zero-width / soft-hyphen variant entirely. ASCII-separator-between-letters (`p.o.r.n`) is a separate harder problem (collapsing all non-letter glyphs aggressively collides with legitimate phrases) and is reasonable to defer to a follow-up. But the ZW class must close before merge.

Add the corresponding test cases to `tests/moderation/moderation.test.ts`.

### P1.3 — `agents.md` does not warn that descriptions are permanently public-attributed

**Reviewer:** core/agent-native.
**Evidence:** `src/build-docs/content/agents.ts:110-120` adds "Set your description" as a procedural section. It documents body shape, length cap, URL redaction, deny-list rejection, and the rate-limit bucket. It does **not** spell out the *consequence model*: every description set via this endpoint is publicly attributed forever to the bot's handle, surfaces on every pixel-click on the canvas, and lives in CDN caches independent of the bot's status. An LLM agent following the contract may dutifully introduce its bot with "Built by jane@company.com on top of OpenAI's o1-2025; source at github.com/jane/private-repo" and ship that as the canvas's permanent attribution.

**Why this blocks ship:** core/agent-native principle says the product surface must be usable by an LLM agent end-to-end with no out-of-band guidance. Privacy / secret-handling guidance is exactly the kind of out-of-band context that has to live IN the contract, not in the operator's head. The bot-self surface is otherwise an excellent agent-native shape — this one paragraph is what closes the loop.

**Fix:** add a 3–5-line "Public attribution" callout to `agents.ts` immediately before or inside the "Set your description" block. Sample text:

> Anything you set as a description is **permanently and publicly attributed to your bot's handle**. It surfaces on the public bot-detail endpoint, in the sector roster, and on every pixel-click attribution UI. It also lives in CDN caches independent of your bot's status. Do **not** include owner identity (real names, email addresses), API key prefixes or fragments, internal repo URLs, system-prompt content, or anything you would not put in a public README. URLs are silently redacted to `[link]` — but that's not a privacy guarantee, just a spam guardrail. If in doubt, leave it empty.

Apply the same warning, condensed to one sentence, near the PATCH /me block in `src/build-docs/content/api.ts:138` ("Bot-self updates").

---

## P2 — strong recommend before merge

These don't block the merge if (b) below is the deploy strategy, but each is a single-PR-sized fix and the bundle is healthier with them in.

### P2.1 — Owner-side description edit is UI-only (no PAT/CLI parity)

**Reviewer:** how-we-build/agent-native.
**Evidence:** the only owner-side path to edit a bot's description is the `"use server"` action `updateDescriptionAction` at `app/bots/_actions.ts:216` wired to the browser form `app/bots/_edit-description-form.tsx`. `PATCH /api/v1/bots/me` is documented as bot-key-only (`src/build-docs/content/api.ts:138` — "sending a PAT or session cookie returns 401"). There is no `PATCH /api/v1/bots/:id` (PAT-auth, owner-scoped) and no `pnpm bot:set-description` shell wrapper. Every sibling owner-write (`bot:create`, `bot:mint-key`, `bot:rotate-key`, `bot:revoke-key`, `pat:mint`, etc.) has both shapes.

**Why this is worth addressing:** AGENTS.md's bedrock principle is "every operator action has a CLI / MCP / HTTP path, never UI-only." Description editing is the only owner-write in M3+ without one. The probe matrix's only non-headless row (probe 16) is exactly the symptom — the agent that operates with a PAT can't run probe 16.

**Fix:** Add `PATCH /api/v1/bots/:id` (PAT or session auth, owner-scoped via the existing `resolveOwner` helper). It calls the same `updateBotDescription({ botId, raw, ownerId })` core. ~50 lines. Then add `scripts/bots/set-description.sh` + a `pnpm bot:set-description` script entry. Probe 16 becomes headless.

### P2.2 — Migration spec drift: requirement says `TIMESTAMPTZ`, migration ships `TIMESTAMP(3)`

**Reviewer:** how-we-build/sacred-schema.
**Evidence:** the requirement specifies `TIMESTAMPTZ` for `description_updated_at` (`requirement-20260515-1155-bot-descriptions.md:34,155`). The migration SQL ships `TIMESTAMP(3)` (`prisma/migrations/20260515120000_bot_description_add/migration.sql:14`). The migration is **correct** — it matches the unbroken project convention from M1 (every audit timestamp uses `TIMESTAMP(3)`). The doc is wrong.

**Fix:** edit the requirement to say `TIMESTAMP(3)`. No code change.

### P2.3 — Rejection→HTTP mapping forked across PATCH /me and the owner action

**Reviewer:** how-we-build/coding-agent-plurality.
**Evidence:** `app/api/v1/bots/me/route.ts:220-231` and `app/bots/_actions.ts:236-261` both rebuild the same `DescriptionRejection`→`{slug, message}` mapping inline. They use slightly different phrasing ("Description must be text" vs "`description` must be a string or null"). Drift bait.

**Fix:** add `describeDescriptionRejection(rejection: DescriptionRejection): { slug, message }` to `src/bots/index.ts` (same shape as `validateHandle` and `validateDisplayName` already use). Both adapters become pure pass-through. ~15 lines.

### P2.4 — No documented rollback runbook for the migration

**Reviewer:** how-we-build/release-and-rollout (downranked from P1).
**Evidence:** the build runs `prisma migrate deploy && next build` on Vercel. The migration is additive + nullable + unindexed, so the forward path is safe. But there is no documented procedure for the reverse — what an operator does if the columns need to come out after a partial deploy or a problem with the moderation logic. The roster route's raw SQL at `app/api/v1/public/sectors/[id]/bots/route.ts:91-104` references `b.description` and would 500 against a schema where the column was dropped.

**Fix:** add a 4-line "Rollback" section to the requirement (or to a sibling probe doc): "revert the code first, leave the columns idle until verified, drop the columns in a follow-up migration only after confirming no code references them." That's the full procedure; the value is having it written.

### P2.5 — No kill-switch for the first public UGC surface

**Reviewer:** how-we-build/release-and-rollout (downranked from P1).
**Evidence:** the requirement explicitly scopes out a kill-switch ("`Scoped Out` § no feature flag, no kill-switch"). The reasoning was sound at writing time, but the reviewer's counter is that this is the **first** surface in Botplace where bot-controlled freeform text reaches public reads. If a moderation false-positive or true-positive incident lands, the only operational response is "edit `blocked-terms.txt`, redeploy" — minutes of latency before takedown.

**Fix:** a 5-line env-var read (`process.env.BOTPLACE_DISABLE_DESCRIPTIONS === "1"`) that nulls `description` on the three read endpoints (`botPublicDetailToJson`, sector roster, single-pixel attribution). Set the env-var in Vercel to take effect in seconds. Optional but high leverage. If you ship without it, document it as a known operational gap in the requirement's R-list so the next incident's response time is informed by a written trade-off, not a missing one.

### P2.6 — URL detector misses `data:`, `javascript:`, IPv4 literal, IPv4-as-decimal, punycode

**Reviewer:** how-we-build/security-and-privacy.
**Evidence:** `lib/moderation/index.ts:59-84`. URL form 1 hardcodes `https?://|www\.`; form 3 requires a literal-dot ASCII-letter-or-digit TLD from the allowlist. Reviewer empirically confirmed bypass for `data:text/html,…`, `javascript:alert(1)`, `file://etc/passwd`, `ipfs://…`, `192.168.1.1`, `2130706433` (IPv4-as-decimal pointing to 127.0.0.1), and `xn--ls8h.la` (punycode). Also: `ftp://example.com` redacts to `ftp://[link]` — the scheme prefix survives because URL form 1 doesn't consume it.

**Fix:** three additions to the URL detector (see reviewer file for exact regex shapes): bare-IPv4 pattern, scheme-agnostic `[a-z][a-z0-9+.-]*://\S+`, and punycode bare-domain. Acknowledge that no regex catches every URL — but the most common evasions deserve coverage. ~10 lines + tests.

### P2.7 — No test for the "never echo matched term" invariant

**Reviewer:** how-we-build/security-and-privacy.
**Evidence:** `tests/moderation/moderation.test.ts` has zero assertions about response or log shape containing or not containing deny-list terms. The PATCH /me route test at `tests/api/bot-self-patch.test.ts:226-234` does scan response strings for the matched term — good — but that test is itself DB-gated and not running in CI (see P1.1). The display-name and handle moderation paths have no equivalent test.

**Fix:** lift the no-echo assertion into a unit-level test that scans the regex matcher's output + the validator return shape. ~20 lines. Pin the invariant outside the DB-gated route layer.

### P2.8 — Scunthorpe-class false positive: country `Niger` rejected

**Reviewer:** how-we-build/security-and-privacy.
**Evidence:** the collapse rule `(\p{L})\1+ → \1` in `lib/moderation/normalize.ts:38` turns the deny term `nigger` into `niger`. The word-boundary regex `\bniger\b` matches the literal name of the African country. A bot writing "I track Niger's parliament" gets rejected as `description_blocked`. (Per reviewer's careful read: `nigeria` / `nigerian` do NOT match because the right-side `\b` fails — only standalone `Niger` is affected. Still a real, dignity-laden false positive.)

**Fix:** two paths — (a) make the collapse a second-pass alternation (regex tries literal `nigger` first; only falls back to collapsed `niger` if the literal didn't match); or (b) maintain a short `allow-override` set of legitimate words that the collapsed forms accidentally hit. Reviewer recommends (a). Add a vitest case asserting `containsBlockedTerm("I track Niger politics")` is `false`.

### P2.9 — Owner-action log omits `latency_ms`, `status`, doesn't surface `request_id`

**Reviewer:** how-we-build/observability-and-incidents.
**Evidence:** `app/bots/_actions.ts:227-277` mints a local request id with `crypto.randomUUID()` and emits info / warn lines, but no `latency_ms`, no `status`, and the UI doesn't see the request id (so a user reporting "the form rejected my description" can't give the operator a correlatable ID). The bot-key PATCH gets this right at `app/api/v1/bots/me/route.ts:271-278`.

**Fix:** add a `startedAt = Date.now()` at the top of `updateDescriptionAction`, emit `latency_ms` on both branches, set `status` in the log shape (200 / 400 / 404), and either pass the `request_id` back to the form state (already returned via `UpdateDescriptionState`) or render it in an inline `<small>` after the save confirmation. ~10 lines.

### P2.10 — No path from a moderation-rejection log line back to the matched term

**Reviewer:** how-we-build/observability-and-incidents.
**Evidence:** the no-echo policy is fine; the operational gap is that **operators** also can't determine which term tripped a rejection without re-running the input through their head. `denylist_version` narrows to the list version, not the term. The requirement R1's recovery loop ("drop this term from `blocked-terms.txt`") has no observable bridge.

**Fix:** log a salted HMAC of the matched term — `denylist_term_hash` — using an operator-only secret. The hash is opaque in logs but mappable on the operator's workstation via `pnpm admin:resolve-blocked-hash`. This stays inside the no-echo invariant (the hash leaks nothing on its own) while restoring forensic actionability. Or skip the hashing and add a private operator log stream — but that's more infra.

### P2.11 — Requirement still `status: draft` after implementation; this review file is the first review artifact written for it

**Reviewer:** core/markdown-everything.
**Evidence:** the implementation is complete, type-checked, lint-clean, and tested (per local report). `plans/requirements/requirement-20260515-1155-bot-descriptions.md:5` still says `status: draft`.

**Fix:** AGENTS.md's milestone lifecycle says: `draft` → `shipped` on the same branch as the milestone PR (or as the final post-merge commit) so the requirement honestly reflects the world. Once probe results land, flip to `status: shipped` + add `shipped: 2026-05-XX`. (Don't preemptively flip — the probe hasn't run against production.)

### P2.12 — Response shape undocumented in `agents.ts`

**Reviewer:** core/agent-native.
**Evidence:** `src/build-docs/content/api.ts:147` documents the response is "the public bot-detail shape." `src/build-docs/content/agents.ts:110-130` (the agent-self-contained contract) only shows the request envelope. An agent working only from `/agents.md` cannot verify the write landed without trial-and-error.

**Fix:** add a `Response:` block + JSON example to the "Set your description" section in agents.ts. ~8 lines.

---

## P3 — defer to follow-ups

These are real but small, and most are documentation gaps rather than code issues.

- **P3.1** — `description_updated_at` is publicly exposed (low-resolution presence signal). Acceptable; document the contract or omit. (security)
- **P3.2** — CDN holds offensive description for up to 70s (`s-maxage=10 + stale-while-revalidate=60`) post-clear. Document the takedown SLA. (security, release)
- **P3.3** — L33t-speak (`p0rn`, `f4g`) is an accepted v1 limitation per R2 but worth a fix when the moderation module gets its next pass. (security)
- **P3.4** — Owner action has no body-byte cap; `app/api/v1/bots/me/route.ts:96-112` does. Add a symmetric `MAX_DESCRIPTION_LENGTH * 4` early-return in `_actions.ts`. (security)
- **P3.5** — Deny-list file in source means anyone with repo-read sees the exact match list. Acceptable for transparency-by-default, but flag in the requirement so it's a deliberate choice. (security)
- **P3.6** — `BLOCKED_LIST_VERSION` is hand-bumped; no CI check that the constant updates when `blocked-terms.txt` does. Add a vitest assertion or a small file-hash check. (security)
- **P3.7** — `UpdateDescriptionResult` discriminated union has an unreachable `not_found` arm that the route's ternary chain miscategorizes as `description_blocked`. Narrow the call-site type, or use exhaustive `switch` with `never` default so future variants fail at compile. (quality-first)
- **P3.8** — Unscoped `prisma.bot.update` in `updateBotDescription` will throw P2025 on a deleted-between-auth-and-write race, surfacing as an unstructured 500. Convert to `updateMany` + count check like the scoped branch, or try/catch + map P2025 → 404. (quality-first)
- **P3.9** — Description that becomes literally `"[link]"` after redaction (pure-URL input) is stored as `"[link]"` with no signal to the caller. Either echo `redactions_count` in the success response, or short-circuit pure-link inputs with `description_invalid`. (quality-first)
- **P3.10** — `validateDescription()` is not extracted into its own `src/bots/description.ts` module the way handle and display_name are. Inlining inside `updateBotDescription` couples description validation to the DB layer. Symmetry argument; not load-bearing. (coding-agent-plurality)
- **P3.11** — Migration's preflight omission is defensible (additive + nullable + unindexed) but not stated. One comment line at the top of the migration SQL would prevent future contributors from mis-pattern-matching against the M3 preflight model. (sacred-schema)
- **P3.12** — Public bot-detail 404s are unthrottled info-level lines. Cuid shape `c[a-z0-9]{24}` is a cheap log-flood vector under scanning. Move to debug-level or sample. (observability)
- **P3.13** — Structured-logs-only audit trail has no documented retention. Vercel default retention is short; deny-list tuning may need ≥ 30 days of moderation rejection lines. Document the target. (observability)
- **P3.14** — `last_seen_at` on bot-detail was added "locking unless redirected" in the requirement Open Questions — implementer shipped it, which is the doc's soft-default. Requirement self-inconsistency: the Open Questions block at line 308 still phrases it as a "possible discussion point." Update the requirement to reflect the lock. (markdown-everything, goldilocks)
- **P3.15** — Deny-list overshot the requirement's "~200-term" estimate (R7) by 57% (314 actual). Not a code issue; flag for future curation pruning if false-positives mount. (goldilocks)
- **P3.16** — Description error shapes missing from agents.ts "Common gotchas." (core/agent-native)
- **P3.17** — Probes aren't a re-runnable script. Generic to the probe ecosystem in this repo; pre-existing. (release)

---

## Cross-cutting themes

A few patterns showed up across multiple reviewers worth calling out:

1. **The moderation pipeline has more bypasses than R2 implies.** Three reviewers (security at P1, observability at P2, quality at P3) pointed at related parts of the same surface. Zero-width / format-control bypass (P1.2) is the must-fix; URL detector breadth (P2.6) and Scunthorpe (P2.8) and the missing no-echo test (P2.7) sit alongside. The requirement's R2 ("low-effort filter, not a security boundary") is the right framing; the implementation just needs to actually catch the *common* evasions, with the exact taxonomy of what's caught vs. accepted written down.

2. **The bot-self path is exemplary; the owner-side path is the regression.** The bot-key PATCH /me route is well-instrumented (latency, request_id, denylist_version, no echo). The owner-side action lacks all of those (P2.9), plus the agent-native CLI/HTTP path is missing entirely (P2.1). Address both together so the two write paths stay symmetric.

3. **Type-system coverage is wider than handler coverage.** The `UpdateDescriptionResult` discriminated union has variants the routes don't switch on exhaustively (P3.7), and the moderation pipeline has limits the test suite doesn't pin (P2.7). Both are the "type checks but runtime might surprise" class. A TS `never` exhaustive default + a no-echo assertion close most of it.

4. **Documentation has minor self-inconsistencies that should reconcile before the requirement flips to shipped.** TIMESTAMP type (P2.2), `last_seen_at` open-question phrasing (P3.14), the open-questions block still framing already-shipped decisions as discussion points. These are 10-minute edits but the requirement should reflect reality before `status: shipped`.

5. **Two reviewers (goldilocks-scoping, sacred-schema) reported essentially clean results.** Scope discipline and the migration are both right-sized. Nothing scoped-out leaked into the implementation (no LLM moderation, no audit-event table, no BotProfile, no pipeline abstraction). This is reassuring evidence that the brainstorm/requirement chain produced a well-bounded result.

---

## Open questions for Travis

- **OQ1.** ZW-character defense (P1.2): commit to the one-line `\p{Cf}` strip before merge? Or also extend to ASCII separators between letters (`p.o.r.n`)?
- **OQ2.** Kill-switch (P2.5): bolt on the 5-line env-var-driven null-out, or accept the documented-gap and write it into the R-list? My recommendation: bolt it on; the cost of having it is trivial.
- **OQ3.** Owner-side PAT/CLI parity (P2.1): land in this PR (one route + one shell script + probe update) or split to an immediate follow-up?
- **OQ4.** CI Postgres (P1.1): is provisioning a CI database an in-scope decision for this PR, or does it want a dedicated infra PR? Either way, the fail-closed alternative (3 lines in vitest.setup.ts) should land **now** so the silent-skip stops masquerading as coverage.
- **OQ5.** Agents.md privacy callout (P1.3): wording approval? The draft in this review is one paragraph and can land as-is.

---

## Action plan

**Pre-merge (P1 fixes — required):**

1. Add `\p{Cf}` strip step to `lib/moderation/normalize.ts:33-40` + corresponding vitest cases for ZWSP, ZWNJ, soft hyphen. *(P1.2; ~5 min change + ~10 min tests.)*
2. Add "Public attribution" warning paragraph to `src/build-docs/content/agents.ts` (and a one-line nudge in `api.ts`'s PATCH /me section). *(P1.3; ~5 min.)*
3. Decide CI strategy: either (a) provision Postgres in `.github/workflows/ci.yml`, or (b) add the fail-closed `CI=true && !DATABASE_URL` check to `vitest.setup.ts`. *(P1.1.)*

**Recommended before merge (P2 batch):**

4. Reconcile TIMESTAMP type in the requirement (P2.2; 2 min).
5. Extract `describeDescriptionRejection` helper (P2.3; 15 min).
6. Add `\b`-bypass test for the no-echo invariant at unit level (P2.7; 15 min).
7. Add `niger`/`Niger` false-positive test + fix collapse alternation (P2.8; 30 min).
8. Add `latency_ms` + `status` + `request_id` surfacing to `updateDescriptionAction` (P2.9; 15 min).
9. URL detector breadth — IPv4, scheme-agnostic, punycode (P2.6; 30 min + tests).
10. Add `PATCH /api/v1/bots/:id` + `pnpm bot:set-description` (P2.1; ~1 hour; OR defer to follow-up).
11. Decide on kill-switch (P2.5; ~10 min env-var read, or doc-only).
12. Rollback runbook in requirement (P2.4; 5 min).
13. `denylist_term_hash` log field (P2.10; 30 min) — or defer.

**Post-deploy:**

14. Run pre-merge probe matrix against the preview deploy.
15. Run probes 19–20 (audit-log shape + display-name grandfathering) against production.
16. Flip requirement `status: shipped` + add `shipped:` date. (P2.11)

**Follow-up PR territory (P3s):**

The P3 batch is reasonable to address as a sibling cleanup PR or distributed across the next few small changes — none of them block this feature's value.

---

## References

- Requirement: [`plans/requirements/requirement-20260515-1155-bot-descriptions.md`](../requirements/requirement-20260515-1155-bot-descriptions.md)
- Brainstorm: [`plans/brainstorms/brainstorm-20260515-1148-bot-descriptions.md`](../brainstorms/brainstorm-20260515-1148-bot-descriptions.md)
- Exit probe: [`docs/dev/probes/bot-descriptions.md`](../../docs/dev/probes/bot-descriptions.md)
- Prior milestone synthesis for shape reference: [`review-20260514-1745-m3-bot-dx-implementation.md`](review-20260514-1745-m3-bot-dx-implementation.md)
- Reviewer outputs (temporary): `/tmp/botplace-review-bot-descriptions/reviewer-*.md` (cleaned up post-synthesis)

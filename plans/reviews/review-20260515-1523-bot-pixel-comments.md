# Bot pixel comments review — multi-reviewer synthesis

**Reviewed:** local branch `feat/bot-pixel-comments` ([PR #28](https://github.com/travisfischer/botplace/pull/28)). ~1100 LOC net across 14 files: new `lib/limits.ts:MAX_COMMENT_LENGTH`, new `src/pixels/comment.ts`, schema migration adding `pixel_events.comment TEXT`, comment threaded through the pixel-write path + two public read endpoints, hosted-docs + probe-doc updates, unit + DB-gated route tests.
**Requirement:** [`requirement-20260515-1450-bot-pixel-comments.md`](../requirements/requirement-20260515-1450-bot-pixel-comments.md) (status `draft`).
**Reviewer set:** same 10 principle reviewers as the previous bot-descriptions synthesis — 8 `how-we-build/*` + 2 `core/*`. **Skipped** (no scope here): `how-we-build/{cloud-coding, compound-engineering, prompt-and-eval-lifecycle}`, `core/{autonomous-learning, llm-model-fluid, universal-evals}`. No infra changes, no eval loops, no prompts, no LLM functionality.
**Date:** 2026-05-15.

## Verdict

**One P1 finding** — the new audit-log fields aren't asserted by any test, mirroring the exact gap that landed as P1.1 of the bot-descriptions review. Close that before merge.

A solid P2 batch is worth landing alongside, mostly small fixes. Two stand out as load-bearing for operator workflow:
- `denylist_version` missing on the pixel-write moderation log line (descriptions always emits it).
- Field-name drift between description and comment log lines forces operators to write two jq filters for the same signal.
- A documentation inconsistency: the single-pixel attribution route returns the literal `[redacted]` (verified by reading the route at [`route.ts:222`](../../app/api/v1/public/sectors/[id]/pixels/[x]/[y]/route.ts)), but the api.ts doc says it returns `null` for the deny-list path. The code is correct; the doc is wrong.

Six reviewers (`goldilocks-scoping`, `core/markdown-everything`, `sacred-schema`, `core/agent-native` on its first finding, `how-we-build/agent-native` essentially clean, and the security reviewer giving a "ship as-is" with two follow-ups) returned no blockers. The shape mirrors the previous feature's review almost exactly, which is the point — the work copied a known-good template cleanly.

## Reviewer outputs

| Reviewer | P1 | P2 | P3 | Verdict |
|---|---|---|---|---|
| how-we-build/agent-native | 0 | 0 | 2 | Clean — write-time-only design means description's parity gap doesn't apply |
| how-we-build/coding-agent-plurality | 0 | 2 | 1 | Solid; slug-naming + rejection-mapping nits |
| how-we-build/quality-first | 2 | 5 | 3 | Untested audit-log fields is the lone P1 |
| how-we-build/sacred-schema | 0 | 0 | 2 | Cleanest schema review I've seen on this project |
| how-we-build/security-and-privacy | 0 | 2 | 1 | Ship as-is; no-echo invariant verified end-to-end |
| how-we-build/goldilocks-scoping | 0 | 0 | 0 | "Just right." Recommends ship as-is |
| how-we-build/observability-and-incidents | 0 | 3 | 0 | Yellow — `denylist_version` missing + field drift |
| how-we-build/release-and-rollout | 0 | 2 | 0 | Yellow — missing Rollback section + probe asymmetry |
| core/markdown-everything | 0 | 0 | 0 | Compliant — brainstorm-skip justified |
| core/agent-native | 0 | 2 | 2 | Discoverability good; write↔read doc asymmetry needs fix |

**Synthesizer re-ranking notes:**
- Quality-first's P1.2 (`comment_length: undefined` on the `comment_invalid` path) **dropped to P2**. JSON.stringify omits undefined values, so the log line is missing a field rather than corrupt. Cosmetic at runtime; worth the one-line fix but not a ship blocker.
- Quality-first's P1.1 (untested log fields) **stays P1**. The previous feature's review treated the same gap as a P1 invariant; same standard applies here. Adding a log spy is ~15 lines.

---

## P1 — ship blocker

### P1.1 — No test pins the new audit-log fields

**Reviewer:** how-we-build/quality-first.
**Evidence:** `app/api/v1/pixels/route.ts:281-285,378-388` emits four new fields (`comment_length`, `comment_redactions_count`, `comment_term_redacted`, optional `denylist_term_hash`). Nothing in `tests/api/pixel-write-comment.test.ts` asserts any log shape — no `vi.spyOn(console, ...)`, no log capture. A silent refactor that drops `denylist_term_hash` from the warn line, or flips `comment_term_redacted` to a string, would still pass tests.

**Why this blocks ship:** The requirement (`plans/requirements/requirement-20260515-1450-bot-pixel-comments.md:108-113`) treats these as load-bearing for operator forensics — they're the moderation incident's only signal under the redact-and-accept policy. The bot-descriptions review treated the analogous gap (`tests/moderation/moderation.test.ts` not asserting the no-echo log invariant) as a P1; same rigor applies.

**Fix:** add a log-spy test in `tests/api/pixel-write-comment.test.ts` covering at least:
- Clean comment → log line carries `comment_length`, `comment_redactions_count: 0`, `comment_term_redacted: false`, no `denylist_term_hash`.
- Deny-list hit → carries `comment_term_redacted: true` + a 16-hex `denylist_term_hash`, **no plaintext term anywhere in the line**, no raw comment body.
- Length reject → warn line carries `field: "comment"`, `error_slug: "comment_too_long"`, no plaintext comment body.

~30 lines.

---

## P2 — strong recommend before merge

### P2.1 — `denylist_version` missing on the pixel-write moderation log line

**Reviewer:** how-we-build/observability-and-incidents.
**Evidence:** `app/api/v1/pixels/route.ts:378-388` (success log) and `:281-285` (rejection log) never include `denylist_version`. The description path always emits it (`app/bots/_actions.ts:299,320`). The previous review explicitly established always-emit `denylist_version` as the moderation-line invariant.

**Why this matters:** an operator forensically asking "was the deny list at version X when this redacted comment landed?" gets that answer on the description surface but not on the pixel-write surface. Same field, different telemetry — silently breaks the invariant.

**Fix:** import `BLOCKED_LIST_VERSION` (already exported from `lib/moderation`) in `app/api/v1/pixels/route.ts` and add `denylist_version: BLOCKED_LIST_VERSION` to the comment-bearing log lines (both success and rejection). One import + one field per call site.

### P2.2 — Field-name drift between description and comment moderation log lines

**Reviewer:** how-we-build/observability-and-incidents.
**Evidence:**

| Concept | Description line | Comment line |
|---|---|---|
| `field` discriminator | `field: "description"` | only on rejection — missing on the success path |
| input length | `length` | `comment_length` |
| URL redaction count | `redactions_count` | `comment_redactions_count` |

An operator querying both surfaces writes two different jq filters: `select(.field == "description" or (.comment_length != null))`. The divergence reads accidental — description fields were named flat because the line already pins `field: "description"`; the comment path invented a per-name prefix but then dropped `field` on the success path.

**Fix:** rename `comment_length` → `length`, `comment_redactions_count` → `redactions_count`, add `field: "comment"` to the success log line whenever a comment was processed, keep `comment_term_redacted` as the boolean (no description equivalent). After the fix, `select(.field == "description" or .field == "comment")` covers all moderation lines uniformly.

### P2.3 — `comment_length: undefined` on the `comment_invalid` rejection path

**Reviewer:** how-we-build/quality-first (P1.2, downranked).
**Evidence:** `app/api/v1/pixels/route.ts:282` reads `commentResult.length` but the validator union (`src/pixels/comment.ts:51-57`) only sets `length` on the `comment_too_long` arm. For `comment_invalid` (non-string input), the spread emits `comment_length: undefined`. JSON.stringify omits the field; the log line is degraded, not broken.

**Fix:** simplest — guard the spread so `comment_length` is included only on `comment_too_long`. Or set `length: 0` on the `comment_invalid` arm of the validator. Pin in the test from P1.1.

### P2.4 — Single-pixel attribution doc claims `null` for deny-list-redacted comments; code returns `[redacted]`

**Reviewer:** core/agent-native.
**Evidence:** Verified the route at `app/api/v1/public/sectors/[id]/pixels/[x]/[y]/route.ts:222` — it returns `event.comment` directly, so a deny-list-redacted row surfaces as the literal string `[redacted]`. But `src/build-docs/content/api.ts:381` says "`comment` is `null` when no comment was set, **or** when the deny-list policy fired."

**Why this matters:** an agent reading the docs and verifying its write via single-pixel attribution will write a check like `if (resp.comment === null) throw new Error("comment not saved")` — and that check will fire incorrectly for any deny-list-redacted comment. The agent's mental model of the API will be wrong.

**Fix:** doc-only. Change the prose in `api.ts:381` to "`comment` is `null` when no comment was set. Deny-list-redacted comments surface as the literal string `[redacted]`, matching the write-time response." The code is right.

### P2.5 — Length-cap error slug shape missing from `agents.md` contract page

**Reviewer:** core/agent-native.
**Evidence:** `src/build-docs/content/agents.ts:64` mentions `comment_too_long` in prose, but the error-response list at line 68 enumerates `invalid_input`/`unauthorized`/`rate_limited`/`server_misconfigured` and stops. An agent reading only `agents.md` (the contract page designed for "tight context budget" agents) sees the slug in prose but not the structured `{field, reason}` shape it should branch on.

**Fix:** one-line addition to the error list: `400 invalid_input` with `field: "comment", reason: "comment_too_long"`.

### P2.6 — Missing Rollback section in the requirement

**Reviewer:** how-we-build/release-and-rollout.
**Evidence:** The bot-descriptions sibling requirement has a `## Rollback` section (line 319). This requirement doesn't — `plans/requirements/requirement-20260515-1450-bot-pixel-comments.md` jumps from Risks straight to "Next steps."

**Fix:** Add a four-line Rollback section. The mechanics are simple (migration is additive+nullable+unindexed; revert the code, leave the column idle, drop as a follow-up after verification). Match the description-requirement's shape.

### P2.7 — Slug-naming convention drift in the validator

**Reviewer:** how-we-build/coding-agent-plurality.
**Evidence:** `validateComment` returns `comment_invalid` / `comment_too_long`. `validateDisplayName` returns `display_name_required` / `display_name_blocked` / `display_name_blocked_url` / `display_name_too_long`. The richer comment success-variant shape (with `termRedacted`, `redactions`) is justified by the redact-not-reject policy, but the error-slug taxonomy should match across helpers so future adapters can grep one convention.

**Fix:** rename `comment_invalid` → `comment_required` (matches `display_name_required`). Keep `comment_too_long`. Two-line change in the validator + one in the test fixture.

### P2.8 — Rejection→HTTP mapping is hand-rolled per route

**Reviewer:** how-we-build/coding-agent-plurality.
**Evidence:** `app/api/v1/pixels/route.ts:271-295` builds the slug→message→response mapping inline. The description-side adapter at `app/api/v1/bots/me/route.ts` does the same shape. A shared `validationErrorResponse(requestId, field, result)` helper would let a future MCP/CLI adapter reuse the slug→message mapping without re-implementing it.

**Fix:** extract a small helper into `lib/route-helpers.ts`. Optional in this PR — fine to defer.

### P2.9 — No kill-switch for comments, not even acknowledged in the R-list

**Reviewer:** how-we-build/security-and-privacy + how-we-build/observability-and-incidents (overlapping finding).
**Evidence:** The requirement defers `BOTPLACE_DISABLE_COMMENTS` (line 42) but doesn't add an R-row acknowledging the containment-speed reduction. Descriptions ships with the analogous `BOTPLACE_DISABLE_DESCRIPTIONS`. Comments has higher surface area (appears in every single-pixel attribution + per-bot events response).

**Fix options (pick one):**
- **Ship the kill-switch.** ~5 lines: a `commentsDisabled()` helper in `@/src/pixels` + null-coalesce `comment` on the two public read endpoints. Mirrors `descriptionsDisabled()` exactly.
- **Document explicitly in the R-list** that the only containment lever for a comment-content incident is per-bot revoke or code revert, so the next operator hits a documented decision instead of a missing one.

### P2.10 — Probe doc has no post-deploy schema sanity check

**Reviewer:** how-we-build/release-and-rollout.
**Evidence:** Probe 1 (schema state) in `docs/dev/probes/bot-pixel-comments.md` is tagged pre-merge only. The bot-descriptions probe doc runs schema probes against production post-deploy. Adds a 30-second `psql` check that the column actually exists in prod after the migration deploys.

**Fix:** duplicate probe 1 into the post-deploy column.

---

## P3 — defer to follow-ups

Small, all reasonable to land later:

- **P3.1** — Sentinel pass-through (`[redacted]`, `[link]`) not tested. A bot can write the literal sentinel as their own input; behavior is documented as ambiguous-but-safe. Add two unit tests. (quality-first)
- **P3.2** — Comment-validator normalization (NFKD + `\p{Cf}` strip + lowercase) is tested transitively via `tests/moderation/`, not directly via `tests/pixels/comment.test.ts`. Three cheap unit tests would pin it. (quality-first)
- **P3.3** — UTF-16 length boundary uses `"a".repeat(N)`. Emoji is 2 code units per glyph — a 64-emoji string trips the 128 cap. Pin the contract explicitly. (quality-first)
- **P3.4** — No route-level test for auth-failure / 429 with a comment present (confirming the comment isn't echoed/persisted/logged on the failure path). (quality-first)
- **P3.5** — No route-level test for explicit `comment: null` vs omitted. Unit-tested but not at the wire. (quality-first)
- **P3.6** — `CommentValidationResult` exhaustiveness is implicit. A `switch (result.slug)` with `satisfies never` default would force future variants to be handled at the route layer. (quality-first)
- **P3.7** — No `pnpm bot:write-pixel` shell wrapper. The bot-author's primary action is still curl-only. Asymmetric with all the owner-side adapters (`bot:create`, `bot:set-description`, etc.). (how-we-build/agent-native)
- **P3.8** — Deny-list tuning still requires a redeploy. Pre-existing gap; mentioned because the comment feature presupposes operator tuning. (how-we-build/agent-native)
- **P3.9** — `[redacted]` storage form on the persisted row carries no out-of-band marker. An operator reading `pixel_events.comment = '[redacted]'` directly can't tell whether a bot wrote that literally or the deny list redacted it. The `denylist_term_hash` lives only in the log. Future audit story might want a sidecar column. (quality-first / security)
- **P3.10** — `[redacted]` sentinel is confusable. Better-default API design would be a sibling `comment_was_redacted: bool` in the response. (security)
- **P3.11** — No admin tool to redact a specific historical comment (only DB mutation). (security)
- **P3.12** — `@db.Text` for a 128-char field — `VARCHAR(128)` would be defense-in-depth if the API-layer cap is ever bypassed. Matches description precedent so consistent, but the precedent is wrong-shaped too. (sacred-schema)
- **P3.13** — `pixel_events.comment` column placement (between `chunkVersionAfter` and `createdAt`) is mildly inconsistent with `Bot.description` which was appended. Cosmetic. (sacred-schema)
- **P3.14** — `LogFields` typed core silently underspecified — moderation fields all ride the index signature. Two features' worth of moderation telemetry is now un-typed. Worth a small hoisting PR later. (observability)
- **P3.15** — Per-coordinate event-history endpoint absent. Acceptable for v1; document explicitly. (observability)
- **P3.16** — `comment_length` log key is ambiguous (trimmed-length-rejection vs stored-length-success). Resolved if P2.2 lands (the field becomes `length` with `field: "comment"` providing the discriminator). (coding-agent-plurality)

---

## Cross-cutting themes

1. **Field-name discipline between sibling moderation features.** The biggest cluster of findings (P2.1, P2.2, P2.7, P3.16) all point at the same root cause: the comment surface didn't precisely copy the description surface's field-naming conventions. Each is small individually; together they make cross-surface operator queries unnecessarily hard.

2. **The redact-and-accept policy reduces in-band signal.** A bot can spew deny-listed comments and never see a 4xx response. Moderation visibility now lives entirely in operator-side telemetry (`denylist_term_hash` + `comment_term_redacted`). That makes the audit-log shape correctness more load-bearing here than for descriptions — which is exactly the cluster P1.1 + P2.1 + P2.3 sit in. Treat the audit log as the product, not as decoration.

3. **The brainstorm-skip was correct, but bumped one decision under the rug.** The kill-switch question (P2.9) didn't get the explicit "we're not shipping this, here's why" treatment a brainstorm would have given it. The requirement's "Out of scope" line is enough mechanically, but the operational consequence (no global mute) deserved an R-row.

4. **Doc inconsistencies on the write↔read schema.** P2.4 + P2.5 + P3.10 all stem from the asymmetry between "stored form is `[redacted]`" (write-side) and how the read endpoints surface it. Pick a story and tell it once across api.ts + agents.ts.

5. **Three reviewers came back clean** (`goldilocks-scoping`, `core/markdown-everything`, `how-we-build/sacred-schema`). The feature's shape is well-bounded; the gaps are seams between this feature and the previous one's conventions, not architectural issues.

---

## Action plan

**Pre-merge (P1 fix — required):**

1. Add a log-spy test in `tests/api/pixel-write-comment.test.ts` covering the clean / redacted / length-rejected cases. *(P1.1; ~30 min.)*

**Recommended before merge (P2 batch):**

2. Add `denylist_version: BLOCKED_LIST_VERSION` to the comment-bearing log lines in `app/api/v1/pixels/route.ts`. *(P2.1; ~5 min.)*
3. Rename log fields to unify with the description shape — `comment_length` → `length`, `comment_redactions_count` → `redactions_count`, add `field: "comment"` on the success log. Pin in the P1.1 test. *(P2.2; ~10 min.)*
4. Fix `comment_length: undefined` on the `comment_invalid` rejection path. *(P2.3; ~3 min.)*
5. Fix the api.ts doc text on the single-pixel attribution shape (`null` → describe `[redacted]` accurately). *(P2.4; ~2 min.)*
6. Add the error slug to `agents.ts`'s error-response list. *(P2.5; ~2 min.)*
7. Add a Rollback section to the requirement. *(P2.6; ~5 min.)*
8. Rename `comment_invalid` → `comment_required` for slug consistency with `display_name_required`. *(P2.7; ~5 min.)*
9. Decide on kill-switch (P2.9): either ship `BOTPLACE_DISABLE_COMMENTS` (~5 lines + a probe row) OR add an R-list entry explaining the deferral. My recommendation is **ship it** — same cost-vs-payoff trade-off as the description kill-switch. *(P2.9; ~15 min.)*
10. Add a post-deploy schema probe row to the probe doc. *(P2.10; ~3 min.)*

**Defer (P2.8 + all P3s):** The rejection→HTTP mapping helper is a refactor that benefits future code, not this PR; defer to a sibling cleanup. The P3 batch is fine to address as a separate small PR or distributed across the next few changes.

**Post-deploy:**

11. Run pre-merge probes 1–12 against the preview deploy.
12. Run post-deploy probes 13–14 (plus the new schema probe from #10) against production.
13. Flip the requirement to `status: shipped` + add `shipped: <YYYY-MM-DD>` once probes pass.

---

## References

- Requirement: [`plans/requirements/requirement-20260515-1450-bot-pixel-comments.md`](../requirements/requirement-20260515-1450-bot-pixel-comments.md)
- Probe doc: [`docs/dev/probes/bot-pixel-comments.md`](../../docs/dev/probes/bot-pixel-comments.md)
- Sibling feature for shape comparison: [`plans/reviews/review-20260515-1244-bot-descriptions.md`](review-20260515-1244-bot-descriptions.md)
- Reviewer outputs (temporary): `/tmp/botplace-review-pixel-comments/reviewer-*.md` (cleaned up post-synthesis)

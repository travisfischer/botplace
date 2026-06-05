---
date: 2026-06-03
target: feat/admin-sector-resets (PR #39) — admin foundation + CLI sector resets
review_type: multi-reviewer-principle
status: addressed
---

# Review: Admin foundation + CLI-only sector resets (PR #39)

- Branch: `feat/admin-sector-resets` → `main` ([botplace#39](https://github.com/travisfischer/botplace/pull/39))
- Requirement: [`requirement-20260603-1109-admin-sector-reset-clis.md`](../requirements/requirement-20260603-1109-admin-sector-reset-clis.md)
- Brainstorm: [`brainstorm-20260602-0803-admin-dashboard-sector-resets.md`](../brainstorms/brainstorm-20260602-0803-admin-dashboard-sector-resets.md)

## Reviewers

Per `review.local.md` (run all default principle reviewers). The 16
registry principles + the repo's own `docs/design/principles.md` were
evaluated by 6 parallel reviewer agents grouped by theme: schema/data
safety; security & privacy; agent-native & surfaces; quality & scoping;
observability/release/cloud; and the LLM/eval/markdown cluster (mostly
N/A for this non-LLM DB-ops change).

**Outcome: no merge-blocker survives.** One P1 (CI red) and all P2s have
been addressed in this branch; remaining items are P3 nice-to-haves.

## P1 — must-fix (resolved)

### P1.1 — `dbUrlWithSsl` dropped the `sslmode=disable` opt-out → CI red
`scripts/admin/_common.mjs`. The helper forced `sslmode=verify-full`
unconditionally, but CI runs against a non-TLS `postgres:16-alpine`
(`.github/workflows/ci.yml` sets `?sslmode=disable`). The canonical
`normalizeSslMode` in `lib/prisma.ts:38-50` has an explicit `disable`
pass-through that this reimplementation omitted, so all three admin
suites hard-failed in CI ("server does not support SSL connections").
The local "422 pass" was against Neon (where `verify-full` works), which
masked it.
**Resolved:** `dbUrlWithSsl` now mirrors the `disable` opt-out; covered
by a pure unit test (`tests/admin/common.test.ts` — disable preserved,
require/absent → verify-full, non-URL unchanged). Push re-runs CI green.

## P2 — should-fix (all resolved)

- **Grant/revoke had no operator attribution in the audit row** (security).
  `admin-accounts.mjs` recorded only the *target*, not who ran it.
  **Resolved:** optional `--actor`/`--actor-id` now resolves the
  operating admin and records `actor_owner_id` + `actor_email` in the
  payload (best-effort, not gated — DB access is the boundary, and the
  first-admin bootstrap can't require a pre-existing admin).
- **`confirmRetype` (the destructive guardrail) was untested** (quality).
  **Resolved:** unit tests via injected streams — exact match, mismatch,
  whitespace trim (`tests/admin/common.test.ts`).
- **Missing edge-case tests** (quality): `sector_not_found` + empty-sector.
  **Resolved:** added to both reset suites (empty-sector also pins the
  "audit row written even with 0 deletions" contract).
- **No-HTTP exemption not annotated at the code surface** (agent-native).
  The direct-DB/CLI-only design deviates from "HTTP endpoints are the
  unit of capability"; the justification lived only in planning docs.
  **Resolved:** header note in `_common.mjs` records the deliberate
  exemption + cross-refs the requirement.
- **Prod confirmation warning printed `branch "(unknown)"`** (release).
  `NEON_BRANCH_NAME` is unset in a Pattern-2 prod shell, blanking the
  one guardrail the runbook leans on.
  **Resolved:** new `dbTargetLabel` falls back to the DATABASE_URL host;
  runbook adds a "confirm the target" step.
  **Follow-up (2026-06-03):** the first fix still _preferred_
  `NEON_BRANCH_NAME` when set, and a real prod `sector-1` reset showed
  that env leaks in from `.env` via `dotenv/config` — so the warning
  printed `branch "dev-4f6874ed"` while connected to prod, lying about
  the target. `dbTargetLabel` now always shows the parsed host as the
  authoritative label and appends any `NEON_BRANCH_NAME` only as
  clearly-flagged secondary context (`tests/admin/common.test.ts`).
- **Interrupted pixel reset = effect without an audit row** (observability).
  Autocommit batched delete writes the audit row only on completion.
  **Resolved (doc):** runbook documents the partial-state window, a
  detection query, and "always re-run to completion". (Restructuring to
  a start+complete audit pair is deferred as P3 — message reset is
  already transactional and has no such window.)
- **PII (`actor_email`) in an append-only audit payload** (privacy).
  **Resolved (doc):** runbook declares the accountability/retention
  trade-off; `actor_owner_id` is the stable key, email a convenience.

## P3 — nice-to-have (deferred / acknowledged)

- `owners_is_admin_idx` is low-selectivity for a rarely-run query.
  Acknowledged — harmless at current scale, an explicit requirement
  decision; could become a partial index or be dropped later.
- `version + 1` per-chunk bump has a documented, accepted race with a
  concurrent writer (no write-fence in v1). Mitigated by the low-traffic
  guidance + re-runnability; runbook now includes a stray-write detector.
- `--actor` is operator-asserted, not authenticated. **Resolved (doc)**
  in `_common.mjs` header + runbook note.
- `VACUUM` whole-table footprint + write-fence detection. **Resolved
  (doc)** in the runbook.
- `main()` boilerplate is near-identical across the two reset CLIs.
  Deferred — extract a `runDestructiveResetCli` helper if a third lands.
- `VACUUM (ANALYZE) pixel_events` uses a hardcoded table literal — no
  injection risk; flagged only against a future refactor.
- On merge: flip the requirement frontmatter to `status: shipped` +
  `shipped: 2026-06-03`.

## Verification

- `pnpm typecheck` — clean
- `pnpm lint` — 0 errors (2 pre-existing warnings, unrelated)
- `pnpm test` — 434 passed, 1 skipped (24 admin tests; unit + integration)
- CI (`typecheck + lint + test`) confirmed green post-fix on PR #39.

## What the reviewers affirmed
- Migration is additive + rewrite-free; FK delete order correct;
  `version` bump-forward preserves the viewer/CDN cache invariant.
- SQL is parameterized throughout; secrets never printed; SSL posture
  matches `lib/prisma.ts`.
- Destructive guardrails (actor-admin check before mutation, retype
  confirm, batched/resumable delete, VACUUM) are well-shaped.
- Use-vs-build surface discipline is clean (no operator tooling leaks
  into `/build/*`, `/api/v1/*`, or bot-author docs).
- Scope is goldilocks-sized for a v1 CLI; tests assert real behavior
  against real Postgres, not mocks.

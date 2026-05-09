---
date: 2026-05-08
shipped: 2026-05-09
type: chore
topic: m1-polish-and-defense-in-depth
status: shipped
planning_depth: standard
---

# Requirement: M1 Polish — Defense-in-Depth, Test Surface, CI, Operator Artifacts

## Status

**Shipped 2026-05-09** in [PR #8](https://github.com/travisfischer/botplace/pull/8). All seven themes (T1–T7) addressed: tagged auth resolvers + expanded `AuthFailureReason` + `auth_type` log field + `AdminAuditEvent` rows on every credential lifecycle event + HMAC-both-sides admin-token compare (T1); pixel-write-tx + auth-invariants tests + coverage thresholds (T2); per-call Upstash timeout + body-size cap + `SECTOR_CACHE` removed + idempotent-revoke contract + memory-fallback dev note (T3); index cleanup migration `20260509052209_m1_polish_index_cleanup` + cascade-rationale comments (T4); `.github/workflows/ci.yml` (T5); `docs/admin/v1.md` + `docs/dev/probes/{replay,redis-outage,concurrency}.md` + `pnpm events:export` + `docs/README.md` TOC (T6); `OWNER_WRITE` rate-limit bucket on credential-mutation endpoints + `pnpm bot:*` / `pnpm pat:*` shell wrappers + shell-only worked example (T7). All tests pass, CI green on first run after the pnpm-version conflict fix.

> **Origin.** This document carves out the consensus P2 themes from the [M1 implementation review](../reviews/review-20260508-1822-m1-implementation-code.md) so the M1 PR can ship without bundling them. The 8 P1 blockers from that review are addressed in the M1 PR itself; everything below is the next layer — observability and security defense-in-depth, the load-bearing tests M1 deferred, the missing CI gate, and the operator-facing artifacts that haven't been written yet.

## Problem / Outcome

M1 ships a working bot API, but several review themes flagged gaps that aren't deployment-blocking and aren't worth re-running the implementation pass for. Each is small in isolation; bundled into the M1 PR they would have doubled the diff and stretched the review cycle. They share enough character — "harden what already works" rather than "build new behavior" — that one polish pass can address them coherently.

The desired outcome is a Botplace M1 surface that:

- Has the same observability + security posture across the **owner-management** routes as the **bot-write** routes (today the bot-write surface is hardened; the owner surface is comparatively bare).
- Has tests that exercise the irreversible code paths — pixel-write transaction byte mutation, byte-identical-401 invariant — not just the unit-pure helpers.
- Has a CI workflow that actually enforces the "required checks passed" rule rather than relying on local discipline.
- Ships the operator-facing artifacts the M1 doc named (admin doc, probe markdown, JSONL export hook) so the M2 hand-off doesn't re-derive them from code.
- Closes the "shell-only loop" for owner mutations: rate-limit them, ship `pnpm bot:*` / `pnpm pat:*` wrappers, and add the `chunks_x`/`chunks_y` field bots need to iterate the canvas without recomputing.

The exit signal is: re-running the same 16 principle reviewers against the post-polish code produces no consensus P2 findings. The remaining P3 list (~20 items) is allowed to carry into M2.

## Scope

### In Scope

#### T1 — Owner-management defense-in-depth

Six adjacent gaps that share one fix pattern. The bot-write surface emits byte-identical 401s with internal `auth_failure_reason` differentiation, audits credential lifecycle, and tags log lines with credential-type. The owner-management surface — every route that mints or revokes credentials — does none of these. Treat them as one piece of work.

- **Tagged auth resolvers.** `botKeyAuth`, `ownerIdFromPersonalAccessToken`, and `readAuth` return either `{ ok: true, ... }` or `{ ok: false, reason: AuthFailureReason }`. Today they return null on every failure mode, collapsing "revoked" + "unknown" + "wrong credential type" into one signal. The byte-identical-401 invariant in the response body is preserved; the differentiation moves into the structured log.
- **Expand the `AuthFailureReason` enum.** Add `revoked_key`, `revoked_bot`, and `wrong_credential_type`. The first is already in `lib/log.ts` but never emitted; the latter two are new.
- **`auth_type` log field.** `readAuth` already computes `session` / `pat` / `bot_key`; surface it as `auth_type` in the log line so operators can attribute read traffic to credential class.
- **Audit credential mints.** `AdminAuditEvent` records revokes today; add a row on every successful PAT mint and bot-key mint (including the M1 owner-driven and rotate paths). Credential issuance is the most security-relevant lifecycle event and currently has no durable trail.
- **Admin auth tightening.** [app/api/v1/admin/revoke-key/route.ts](../../app/api/v1/admin/revoke-key/route.ts) short-circuits on `length !==` before `timingSafeEqual`. HMAC both sides first, then constant-time compare. Failed admin auth attempts also write an `AdminAuditEvent` row (today they emit a console warn and that's it — exactly the signal you most want during an attempted compromise).
- **Pixel-write log distinguishes `wrong_credential_type` from `malformed_header`.** Today a PAT-shaped token at the pixel-write endpoint logs as `malformed_header`; the operator can't tell "agent used the wrong key kind" from "header was junk."

Acceptance: every owner endpoint emits the same structured log shape as the pixel-write endpoint, with `auth_type` tagged. Every credential mint, revoke, and rotation produces an `AdminAuditEvent` row. Failed admin auth produces an `AdminAuditEvent` row. The byte-identical-401 invariant holds in all cases (test added under T2).

#### T2 — Tests for the irreversible code paths

The M1 unit tests cover the pure helpers (chunk math, palette, in-memory rate-limit bucket, key hashing) and one DB-backed replay test (B3 from the M1 PR). They do **not** cover:

- The `writePixel` transaction itself — `SELECT ... FOR UPDATE`, byte mutation at offset, version increment, event-log insert. Replay works because writes worked, but the byte-mutation-at-offset isn't directly asserted.
- The byte-identical-401 invariant. Documented contract; nothing exercises it.
- The admin 404-vs-401 information-disclosure invariant.
- The route layer in general — `vitest.config.ts` includes `app/**/*.ts` in coverage but every route reads 0%.

Acceptance:
- `tests/api/pixel-write-tx.test.ts` writes pixels at known offsets, asserts the resulting byte at the right index in the chunk blob, and asserts the version increment matches the event count.
- `tests/api/auth-invariants.test.ts` (or extend an existing file) imports the route module directly and probes the four 401 branches with identical body bytes; probes the admin endpoint with missing/wrong/right tokens, asserting 404/404/200.
- Coverage thresholds set in `vitest.config.ts` for `src/**` and `lib/**` (start at 70% statements, 60% branches; tighten over time).
- Both new test files run under the existing `pnpm test` and skip cleanly when `DATABASE_URL` is unset (same gate as `tests/api/replay.test.ts`).

#### T3 — Inline polish on a few small implementation choices

- **`SECTOR_CACHE` is unbounded with no invalidation.** [app/api/v1/pixels/route.ts](../../app/api/v1/pixels/route.ts) caches `(width, height, paletteVersion)` per sector forever. Safe in M1 because there's no admin-mutation endpoint, but it lays a hidden footgun for M2 sector creation. Either delete (DB hit per write is fine at M1 scale), gate caching to a hardcoded allow-list of immutable sectors (`["sector-1"]`), or add a TTL + cap. Document the choice inline.
- **Body-size cap before JSON parse.** [app/api/v1/pixels/route.ts](../../app/api/v1/pixels/route.ts) parses the body before the rate-limit check. A misbehaving client can blow memory on a giant body before the limiter sees the request. Reject with 413 on `Content-Length > 2KB` (the legitimate body is ~80 bytes).
- **Per-call timeout on Upstash REST client.** "Fail-closed" only applies if the call returns. Pass `signal: AbortSignal.timeout(2000)` (or wrap with a `Promise.race` timeout) so a hanging Upstash call surfaces as `rate_limit_unavailable` (503) within 2 seconds, not whenever Vercel's invocation timeout fires.
- **Memory rate-limit fallback documented.** The dev-only in-process fallback was a deliberate choice; one of the doc-review reviewers flagged it as scope creep. Add a one-line note in `docs/dev/setup.md` (or wherever the dev story lives) naming it as deliberate, so the next reviewer doesn't re-flag it.
- **Idempotent admin revoke.** [app/api/v1/admin/revoke-key/route.ts](../../app/api/v1/admin/revoke-key/route.ts) returns `{ idempotent: true }` on a no-op revoke and writes an `AdminAuditEvent` row even when nothing changed. Either keep + document the contract in `docs/api/v1.md`, or drop the `idempotent` field and skip the audit row on no-op.

Acceptance: each item gets either a code change or one explicit doc line. No silent decisions.

#### T4 — Schema cleanup against `database-conventions.md`

Single migration touching index shape and field order; no semantic change.

- **Drop `Bot.@@index([ownerId])`** — redundant with `@@unique([ownerId, name])`.
- **Replace `BotApiKey.@@index([botId])` with `@@index([botId, revokedAt])` partial.** The hot read pattern is "active keys for this bot."
- **Reorder lifecycle fields** in `BotApiKey` and `OwnerPersonalAccessToken` so `createdAt`, `revokedAt`, `lastUsedAt` are adjacent, per [docs/design/database-conventions.md](../../docs/design/database-conventions.md) lines 20–29.
- **Comment cascade choices.** Three lines on `pixel_events` foreign keys naming the audit-lineage rationale, so a future operator hitting an FK violation reaches for the right fix instead of `Cascade`.

Acceptance: one Prisma migration, schema validates, all tests pass.

#### T5 — CI workflow

`.github/workflows/ci.yml` running `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm db:validate` on PRs. ~30 lines. The Minimal Release Checklist's "required checks passed" rule is structurally unsatisfiable today; this closes it. Tests that need `DATABASE_URL` skip themselves (per T2 and replay.test.ts), so CI doesn't need a DB.

Acceptance: a PR can be blocked by CI failure; the existing scripts in `package.json` are sufficient (no new build steps).

#### T6 — Operator-facing artifacts

The M1 doc named operator artifacts that didn't ship in the M1 PR:

- **`docs/admin/v1.md`** (or admin section in `docs/api/v1.md`) — the operator-facing surface is in code only. Document the `revoke-key` endpoint, the static-admin-token convention, the `pnpm admin:revoke-key` wrapper, the `AdminAuditEvent` shape, and the 404-on-missing-token rationale.
- **`docs/dev/probes/`** — the "compounding deliverables" probes named in the M1 doc (concurrency probe, replay probe, Redis-outage probe) leave no markdown trace. One file per probe (~30 lines each): how to run it, what it validates, expected output. The replay probe can largely point at `pnpm test:api:replay` shipped in the M1 PR.
- **`pnpm events:export` script.** Append-only `PixelEvent` is the textbook JSONL exception. Markdown-everything reviewer escalated this to P1. Ship as a small script (~20 lines): `prisma` raw query streaming `PixelEvent` rows ordered by `(sector_id, id) ASC` to stdout as JSONL. The replay-test acceptance criterion implicitly depends on a JSONL-exportable event log being trivial to inspect.

Acceptance: each artifact exists and is reachable from a top-level table-of-contents (either `docs/README.md` or the project README). `pnpm events:export | head -1` returns one valid JSON line.

#### T7 — Owner-management surface completeness

- **Rate-limit owner mutations.** `POST /api/v1/bots`, `POST /api/v1/bots/:id/keys`, `POST /api/v1/bots/:id/keys/:keyId/rotate`, `POST /api/v1/owner/tokens`. A stolen PAT today gives an attacker unlimited write to the credential surface. Apply a per-owner write bucket — same `Limiter` interface, smaller capacity (30/min/owner is fine; the human form rarely exceeds 1/min).
- **`pnpm bot:*` and `pnpm pat:*` shell wrappers.** Per the agent-native principle, every operator action has a shell path. Today bot creation requires DevTools or a hand-built `curl`. Add `scripts/bots/{create,list,mint-key,rotate-key,revoke-key}.sh` and `scripts/pat/{mint,list,revoke}.sh` (~10 lines each — sources `BOTPLACE_PAT` from env, hits the JSON endpoint).
- **End-to-end shell-only worked example in `docs/api/v1.md`.** "Mint a PAT (after one-time OAuth) → mint a bot → mint a bot key → write a pixel → read it back" as a single copy-pasteable shell session. The doc has the endpoints; it doesn't have the orchestration.

Acceptance: every owner mutation route returns 429 under sustained load. `bash scripts/bots/create.sh "test-bot"` works against the dev branch with `BOTPLACE_PAT` set. `docs/api/v1.md` has a runnable bootstrap section.

### Out of Scope (deliberate)

- **All M1 P3 items** (~20 in the review) — note for M2/M3, don't fold in.
- **`SECTOR_CACHE` invalidation hook for M2 sector creation** — M2 ships the admin sector-mutation endpoint; the cache lifecycle is M2's problem.
- **`OwnerAuditEvent`** as a separate model — extending `AdminAuditEvent` with an `actor_kind` and `actor_id` covers the same need with one fewer table.
- **Per-read-type rate-limit buckets** (sector-meta vs single-pixel vs chunk) — operator-friendly to share, an M3-or-later concern.
- **Latency-stage breakdown** (`db_latency_ms` separate from `latency_ms`) — fine for now; M4 dashboards can ask for it then.

## Validation Strategy

Re-run the M1 implementation review (`/project:review`) against the polish-pass code with the same 16 principles minus the four no-findings reviewers (`prompt-and-eval-lifecycle`, `autonomous-learning`, `llm-model-fluid`, `universal-evals` — confirmed vacuous for an M1 server with no LLM surface). Pass criterion: zero consensus P1s, zero P2s with 3+ reviewer agreement. Single-reviewer P2s and P3s are allowed to carry forward.

Manual verification matrix:

| Claim | How to verify |
|---|---|
| Owner routes log structured JSON with `auth_type` | grep `auth_type` in dev server logs after hitting `/api/v1/bots` with a PAT |
| Failed admin auth produces audit row | `pnpm admin:revoke-key bad-token` then `select * from admin_audit_events order by id desc limit 1` |
| Byte-identical 401 across auth-failure branches | Run `tests/api/auth-invariants.test.ts` |
| Pixel-write tx mutates the right byte | Run `tests/api/pixel-write-tx.test.ts` |
| CI blocks merges on lint/test failure | Open a draft PR with a deliberate lint error; assert the GitHub Actions check is red |
| Owner mutations are rate-limited | `for i in {1..40}; do bash scripts/bots/create.sh "x$i"; done` and assert 429 within the first ~30 |
| Replay export | `pnpm events:export \| jq -c .` produces valid JSONL |

## Acceptance Criteria

- [ ] All seven themes (T1–T7) addressed in code, docs, or both.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` clean.
- [ ] CI workflow green on the polish-PR branch.
- [ ] Re-run review produces zero consensus P1/P2 findings.
- [ ] M1 doc flips from `status: draft` to `status: shipped` once this PR lands.

## Open Questions

- **CI provider:** confirm GitHub Actions is the right venue (vs Vercel checks). Vercel deploy preview is already wired; Actions is the right place for tests/typecheck.
- **`SECTOR_CACHE`:** delete vs. allow-list vs. TTL. Delete is simplest; defer until M2 unless a real perf signal shows up.
- **`AdminAuditEvent.actor_kind`:** add now (forward-compatible), or wait for M3+ when admin actors become more diverse?
- **Test fixture strategy:** the replay test creates+tears-down per test. T2 tests will likely follow the same pattern — confirm before scaling out.

## Possible Future Enhancements

- Per-credential-class read rate-limit buckets.
- Per-stage latency breakdown for M4 dashboards.
- `pnpm events:export` streamed straight to S3 / blob storage.
- `OwnerAuditEvent` if the `actor_kind` extension to `AdminAuditEvent` proves cramped.

## References

- Source review: [`plans/reviews/review-20260508-1822-m1-implementation-code.md`](../reviews/review-20260508-1822-m1-implementation-code.md) — themes T1–T7.
- Parent milestone: [`requirement-20260508-1121-milestone-1-bot-registration-and-pixel-api.md`](requirement-20260508-1121-milestone-1-bot-registration-and-pixel-api.md).
- Project principles: [`docs/design/principles.md`](../../docs/design/principles.md).
- Database conventions: [`docs/design/database-conventions.md`](../../docs/design/database-conventions.md).

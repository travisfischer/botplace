---
date: 2026-05-08
type: review
target: M1 implementation code (post-doc-review, pre-PR)
status: addressed
recommendation: address P1 blockers before opening the M1 PR; P2 themes can land in follow-on commits or a polish PR.
---

> **Resolution (2026-05-08).** All 8 P1 blockers (B1–B8) are addressed in the M1 PR. The consensus P2 themes (T1–T7) are carved out into a dedicated polish requirement: [`requirement-20260508-1900-m1-polish-and-defense-in-depth.md`](../requirements/requirement-20260508-1900-m1-polish-and-defense-in-depth.md). P3 items remain as a no-block notes list, scheduled for natural pickup as files are touched in M2+. Per-item developer decisions inline below.

# Review: Milestone 1 — Implementation Code

## Conventions

Each actionable finding (and each P2 theme) is followed by a **Developer Decision:** block where the developer records their response. Format: a short verb (`accept` / `modify` / `reject` / `defer`) plus one-line rationale, optionally followed by notes. Empty blocks are pending decisions. (Same convention as the M1 doc review.)

## Verdict

**Not ready to open the PR.** The implementation is high-quality for an MVP — domain split is clean, security primitives are well-shaped (HMAC + pepper + byte-identical 401 + 404-on-missing-admin-token + fail-closed rate limit), the schema follows the conventions doc and matches the requirement byte-for-byte, and the structured-log shape is locked in. **But** the implementation drifted from the post-review M1 doc in eight specific places, and three of those drifts (rate-limit headers, owner-management observability, atomic key rotation) are explicit functional/NFR contracts the doc commits to. None are deep refactors — most are mechanical "wire what's already there" fixes, achievable in a single follow-up pass before the M1 PR opens.

The recommendation is to fix the eight P1 drifts (an afternoon of work), then re-run the targeted reviewers (sacred-schema, observability, agent-native, quality-first, compound) on the revised code before the PR opens. P2/P3 work can either land in the same PR or a polish-pass PR after.

## Reviewer summary

16 principle reviewers ran in parallel against the M1 code (full registry, `review.local.md` unchanged from doc-review). Aggregate counts:

- **P1 (must fix before PR opens):** 17
- **P2 (important — same PR or fast follow-up):** ~45
- **P3 (notes / debt):** ~30

12 reviewers produced findings; 4 cleanly returned no-findings (`prompt-and-eval-lifecycle`, `autonomous-learning`, `llm-model-fluid`, `universal-evals`) — same set as the doc review, same reason (M1 server has no LLM/model-driven functionality, so these principles are vacuously satisfied).

Per-reviewer raw outputs at `/tmp/botplace-codereview-20260508-1822/reviewer-*.md` during this run; cleaned up after this synthesis lands.

---

## P1 blockers — must address before opening the M1 PR

The 17 P1 findings cluster into **8 distinct issues**. Listed in order of cross-reviewer signal (most agreement first).

### B1. Rate-limit headers are silently absent — direct violation of the M1 contract

**Sources:** `core-agent-native` (P1-1), `how-we-build-agent-native` (P1), `goldilocks-scoping` (G2.4), `markdown-everything` (P2.3), `quality-first` (P2-2). **Five-reviewer agreement** — the strongest signal in the set.

The M1 requirement (line 30, line 218) is unambiguous:

> "On success returns ... plus headers `X-RateLimit-Remaining-Bot`, `X-RateLimit-Remaining-Ip`, `X-RateLimit-Reset-Bot`, `X-RateLimit-Reset-Ip`. The rate-limit headers are echoed on both success and 429 responses so agents can plan write cadence without colliding."

The implementation emits **only** `Retry-After` on 429 and **nothing** on success. The successful-path `botResult.reset` and `botResult.remaining` from [lib/rate-limit.ts:171](lib/rate-limit.ts) are computed but never surfaced. Read endpoints (sector metadata, single-pixel, chunk) have the same gap — no `X-RateLimit-*` on either success or 429.

This is the canonical agent-native regression: a coding agent reading the docs cold cannot plan cadence without provoking 429s. The `docs/api/v1.md:203` advice ("send at most one write per minute per bot key, regardless of `Retry-After`") is a workaround for the missing headers — once the headers ship, that advice should be revised.

**Fix:** thread bot+IP+read `{remaining, reset}` out of `checkPixelWriteRateLimit` and `checkReadRateLimit`. Emit on success and 429 paths across `app/api/v1/pixels/route.ts` and the three read endpoints. Update `docs/api/v1.md` to document the headers.

**Developer Decision:** `accept`. Split outcome types in `lib/rate-limit.ts` into `WriteRateLimitOutcome` and `ReadRateLimitOutcome` (both carry full `BucketState`), added `pixelWriteRateLimitHeaders()` and `readRateLimitHeaders()`, wired into success + 429 paths across all four pixel/read routes. `docs/api/v1.md` update folded into the M1 PR.

### B2. Owner-management endpoints emit no structured logs and no `request_id` — breaks the documented response/log contract

**Sources:** `observability-and-incidents` (P1-1), `core-agent-native` (P1-2), `how-we-build-agent-native` (implicit), `security-and-privacy` (P2 first), `quality-first` (P2-3). **Four-reviewer agreement.**

`docs/api/v1.md:22` says `request_id` is on **every** success response and matches **a single structured log line** on the server. The owner-management endpoints — every M1 mutation that mints or revokes credentials — emit neither:

- [app/api/v1/bots/route.ts](app/api/v1/bots/route.ts) — `POST` + `GET`. No `request_id`, no `log()`.
- [app/api/v1/bots/[id]/keys/route.ts](app/api/v1/bots/%5Bid%5D/keys/route.ts) — same.
- [app/api/v1/bots/[id]/keys/[keyId]/route.ts](app/api/v1/bots/%5Bid%5D/keys/%5BkeyId%5D/route.ts) — same.
- [app/api/v1/owner/tokens/route.ts](app/api/v1/owner/tokens/route.ts) — same.
- [app/api/v1/owner/tokens/[id]/route.ts](app/api/v1/owner/tokens/%5Bid%5D/route.ts) — same.

The doc-review B1 fix specifically expanded M1 so an agent could mint bots without driving a browser. That fix shipped at the URL level, but the operability story for those endpoints regressed: when an agent's PAT-driven workflow fails with 409 / 401, there's no `request_id` to quote, and credential mints (PATs! bot keys!) leave no log trail. After a stolen-session incident, log-based reconstruction is impossible on the surface that mints credentials.

**Fix:** wrap each owner endpoint with the same `randomUUID()` + `log()` + `request_id`-in-body pattern used by the pixel-write and read routes. Mechanical — extract a small `withRequestLog(path, handler)` helper to prevent drift, then call sites become 5-line glue.

**Developer Decision:** `accept`. New [`lib/route-helpers.ts`](../../lib/route-helpers.ts) with `newRouteContext` / `resolveOwner` / `requirePepper` / `jsonOk` / `jsonError` / `unauthorized` / `readNameBody`. All five owner routes refactored — every response now carries `request_id`, every path emits a structured log line. 204 deletes carry `X-Request-Id` instead of a body field. Bundled with B6 (snake_case mappers).

### B3. `pnpm test:api:*` scripts named in the requirement don't exist

**Sources:** `compound-engineering` (P1-1), `how-we-build-agent-native` (P2), `release-and-rollout` (P2-2), `markdown-everything` (P2.1). **Four-reviewer agreement.**

The requirement's Validation Strategy (lines 333–340) and Acceptance Criteria (line 288) explicitly name `pnpm test:api:smoke`, `pnpm test:api:replay <sector_id>`, and `pnpm test:api:auth` as committed scripts. None exist in `package.json`:

```
admin:revoke-key, build, db:bootstrap, db:branch:cleanup, db:check, db:generate,
db:migrate:deploy, db:migrate:dev, db:validate, dev, env:check, lint, postinstall,
start, test, test:coverage, test:watch, typecheck, vercel-build
```

`test:api:replay` is the most load-bearing of the three: the requirement names it as the binary check that the event log + chunk state stay in sync, and it's the canonical M2 hand-off probe. Manual probes don't compound — the next person who needs to verify chunk-state correctness will re-derive the procedure.

**Fix (minimum):** ship `pnpm test:api:replay` as an in-process integration test (~50 lines, no HTTP needed). Replay PixelEvent rows ordered by `(sector_id, id) ASC`, reconstruct chunk blobs, byte-compare against live state. `test:api:smoke` and `test:api:auth` can be `[manual pre-release]` shell wrappers that exit non-zero on the wrong status, but name them in `docs/api/v1.md` so the next agent can find them.

**Developer Decision:** `accept` minimum. [`tests/api/replay.test.ts`](../../tests/api/replay.test.ts) ships as the canonical replay probe — seeds a fresh sector + owner + bot + key, writes 12 pixels (with same-pixel overwrites across two chunks), replays in `(sector_id, id) ASC` order, byte-compares reconstructed chunks against live `SectorChunk.data`. Skips when `DATABASE_URL` is unset. New `pnpm test:api:replay` script + `vitest.setup.ts` to load `.env`. `test:api:smoke` and `test:api:auth` deferred to the M1-polish requirement (T2).

### B4. `pnpm env:check` doesn't cover the M1-introduced env vars; no `assertSecretsPresent()` boot gate

**Sources:** `cloud-coding` (P1 F1 + F2), `release-and-rollout` (P1-2), `compound-engineering` (P2-3 + P2-4), `quality-first` (P1-1). **Four-reviewer agreement.**

The requirement (line 245) explicitly mandates:

> "A single `assertSecretsPresent()` invoked at boot refuses to serve any request if any of `BOTPLACE_API_KEY_PEPPER`, `ADMIN_TOKEN`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` is empty."

There's no such function in the codebase. Each route does its own ad-hoc `if (!process.env.X)` guard:

- [app/api/v1/pixels/route.ts:70](app/api/v1/pixels/route.ts) — only checks pepper.
- [app/api/v1/admin/revoke-key/route.ts:16](app/api/v1/admin/revoke-key/route.ts) — only `ADMIN_TOKEN`.
- Sector read routes — none. `readAuth` returns null when pepper is missing, which silently forces session-only auth on what should be a 503.

[scripts/env/check-env.sh](scripts/env/check-env.sh) checks 7 vars: `NEON_API_KEY`, `NEON_PROJECT_ID`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH_NAME`, `BOTPLACE_API_KEY_PEPPER`, `AUTH_SECRET`. Missing: `ADMIN_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `UPSTASH_REDIS_REST_URL` (or `KV_REST_API_URL`), `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_TOKEN`).

A misconfigured production deploy boots and serves 503s on every write instead of the doc-promised "refuses to start." The fail mode is operationally similar (503s either way) but the symptom is noisier and the diagnostic path is harder.

**Fix:** add the missing checks to `scripts/env/check-env.sh` (5-line patch). Add `lib/secrets.ts` with `assertSecretsPresent()`, called from a top-level module that every route imports (or — simpler — at the top of `lib/prisma.ts`). Both fixes together: ~30 LOC.

**Developer Decision:** `accept`. New [`lib/secrets.ts`](../../lib/secrets.ts) with `findMissingSecrets()` + `assertSecretsPresent()`, wired into [`instrumentation.ts`](../../instrumentation.ts) (Next 16's standard boot hook). Production refuses to start; dev warns. `scripts/env/check-env.sh` extended to cover all M1 vars including Upstash detection across either canonical or `KV_*` naming.

### B5. `lastUsedAt` is read by the UI/API but never written by any auth resolver — column permanently null

**Sources:** `observability-and-incidents` (P1-2), `core-agent-native` (P2-3), `quality-first` (P2-1), `sacred-schema` (P2-3), `how-we-build-agent-native` (P3), `security-and-privacy` (P3). **Six-reviewer agreement** — even more than the headers issue.

`BotApiKey.lastUsedAt` and `OwnerPersonalAccessToken.lastUsedAt` ([prisma/schema.prisma:69, :40](prisma/schema.prisma)) are present in the schema, surfaced in the [/bots UI](app/bots/page.tsx), and `select`'d in [src/bots/index.ts:89](src/bots/index.ts) and [src/auth/pat.ts:87](src/auth/pat.ts). No auth resolver writes them — [src/auth/bot-keys.ts](src/auth/bot-keys.ts), [src/auth/pat.ts](src/auth/pat.ts), [src/auth/read-auth.ts](src/auth/read-auth.ts) all skip the update.

The UI says "last used: never" forever for active credentials. Operators investigating "is this key dormant, safe to revoke?" or "was the leaked key used between T1 and T2?" cannot answer from credential rows — only from `PixelEvent`, which omits read-only PAT/bot-key activity.

**Fix:** in `botKeyAuth` and `ownerIdFromPersonalAccessToken`, after a successful resolve, fire-and-forget `prisma.<table>.update({ where: { id }, data: { lastUsedAt: new Date() } })`. Don't await on the hot path. Three lines per call site. Optionally throttle to once-per-minute-per-key if write volume becomes a concern, but at M1 scale unthrottled is fine.

**Developer Decision:** `accept`. Fire-and-forget `lastUsedAt` updates added to `botKeyAuth` ([src/auth/bot-keys.ts](../../src/auth/bot-keys.ts)) and `ownerIdFromPersonalAccessToken` ([src/auth/pat.ts](../../src/auth/pat.ts)). `.catch(() => {})` swallows transient failures since auth has already succeeded and the freshness signal is advisory. Throttling deferred — at M1 scale (~1 write/min/key) the extra UPDATE per request is negligible.

### B6. JSON casing inconsistency — pixel API uses `snake_case`, owner API leaks Prisma `camelCase`; generated bot clients will break

**Sources:** `core-agent-native` (P1-3), `quality-first` (implied via P2-3 inconsistent shape).

The pixel-write and read endpoints serialize **snake_case**: `sector_id`, `chunk_version`, `accepted_at`, `palette_version`, `default_color`, `chunk_size`, `updated_at`, `request_id` (e.g. [app/api/v1/pixels/route.ts:276-284](app/api/v1/pixels/route.ts)).

The owner-management endpoints serialize **camelCase** because they `Response.json(prismaRow)` directly — `createdAt`, `revokedAt`, `lastUsedAt`, `apiKey`, `apiKeys` (e.g. [src/bots/index.ts:60-94](src/bots/index.ts), [src/auth/pat.ts:39-90](src/auth/pat.ts)).

The doc shows snake_case for pixels but no response examples for owner endpoints, so a coding agent generating a typed client from the docs will silently parse half the surface wrong. Every future SDK / MCP wrapper has to special-case half the surface.

**Fix:** pick one casing convention (snake_case is the more common HTTP-API convention and matches the pixel surface). Add an explicit JSON-shape transform in `src/bots/index.ts` and `src/auth/pat.ts` (Prisma `select` + manual map, or a small `toJson(bot)` helper). Add response examples to the owner section of `docs/api/v1.md`. ~50 LOC.

**Developer Decision:** `accept` (snake_case). Mappers added: `botSummaryToJson` / `botApiKeySummaryToJson` / `mintedBotApiKeyToJson` / `createBotResultToJson` in [src/bots/index.ts](../../src/bots/index.ts); `personalAccessTokenSummaryToJson` / `mintPersonalAccessTokenResultToJson` in [src/auth/pat.ts](../../src/auth/pat.ts). All five owner routes pipe through these mappers — no Prisma row escapes through HTTP. `docs/api/v1.md` owner-endpoint examples folded into the M1 PR.

### B7. Atomic key rotation endpoint is required by the spec but not implemented

**Sources:** `quality-first` (P1-3).

Functional requirement line 215:

> "A signed-in owner can rotate a key (mint new + revoke old) atomically via a single endpoint call."

There's no rotate endpoint and no `rotateBotApiKey` function in [src/bots/index.ts](src/bots/index.ts). Owners would have to call mint + revoke as two non-atomic calls; between the two, two active keys exist in plaintext, and a partial failure leaks one without recording the rotation.

**Fix:** add `rotateBotApiKey({ botId, oldKeyId, ownerId, pepper })` doing mint + revoke inside `prisma.$transaction`, plus `POST /api/v1/bots/:id/keys/:keyId/rotate` (or a `?rotate=true` flag on the existing mint endpoint). ~30 LOC. Or — explicitly defer to M3+ and strike from the spec.

**Developer Decision:** `accept`. `rotateBotApiKey` added to [src/bots/index.ts](../../src/bots/index.ts) — revokes-then-mints inside a single `prisma.$transaction`, aborting cleanly if the old key isn't an active key on a bot the caller owns. New endpoint at [POST /api/v1/bots/:id/keys/:keyId/rotate](../../app/api/v1/bots/[id]/keys/[keyId]/rotate/route.ts).

### B8. `lib/log.ts` `JSON.stringify` is uncaught; `lib/rate-limit.ts` doesn't validate Upstash response shape — fail-open vector

**Sources:** `compound-engineering` (P1-2 + P1-3), `observability-and-incidents` (P2-1).

Two related quality gates on the most load-bearing infra primitives, both with one-line fail-modes:

**B8a. log.ts will throw on stray BigInt.** [lib/log.ts:35](lib/log.ts) calls `JSON.stringify` with no replacer. `JSON.stringify(BigInt)` throws. The four routes today route BigInt fields (chunk versions) through `.toString()` first, but a future route author who logs `chunkVersion` directly will silently 500 the entire request. The principle's "always emits something" contract for a logger is broken.

**B8b. Rate-limit fail-closed scope is too narrow.** [lib/rate-limit.ts:142-206](lib/rate-limit.ts) catches thrown exceptions — it does NOT validate the response shape. Upstash returning `{ success: undefined }` (truthy: false → 429), `{ success: "true" }` (truthy: true → 200 incorrectly), or a 200 with no body all pass through. The requirement (line 254) explicitly demands tests for **four** failure modes (broken-host, timeout, SDK exception, malformed-response); only the first three are partially exercised by the catch block.

**Fix:**
- `lib/log.ts:35`: wrap `JSON.stringify` with a replacer that converts `BigInt → string`. 2 lines.
- `lib/rate-limit.ts adaptUpstashLimiter`: validate `typeof result.success === "boolean"` and `typeof result.reset === "number"` before returning; throw otherwise so the outer catch turns it into 503.
- Add `tests/rate-limit/upstash-failure-modes.test.ts` with the four cases enumerated in the NFR. ~50 LOC.

**Developer Decision:** `accept`. [`lib/log.ts`](../../lib/log.ts) now uses a `safeReplacer` (BigInt → string) and wraps `JSON.stringify` in try/catch with a degraded-line fallback so a logger failure can never kill the request. [`lib/rate-limit.ts`](../../lib/rate-limit.ts) extracted `coerceUpstashResult` for fail-closed shape validation; [`tests/rate-limit/upstash-shape.test.ts`](../../tests/rate-limit/upstash-shape.test.ts) covers the seven malformed-response branches enumerated in the NFR.

---

## P2 themes — fix in the same PR or a fast follow-up

The ~45 P2 findings cluster into 7 themes.

### T1. Owner-management surface lacks the security/observability defense-in-depth the bot-write surface has

Six adjacent gaps that share the same fix pattern:

- **`auth_failure_reason` enum has `revoked_key` but it's never emitted.** `botKeyAuth` collapses revoked + unknown into one null return; route logs `unknown_key`. Read endpoints don't emit `auth_failure_reason` at all. Internal log differentiation that the byte-identical-401 invariant was designed to enable is missing. (Observability P2-4, security-and-privacy P2, core-agent-native P2-4, quality-first P2-5.)
- **PAT mint and bot-key mint write no `AdminAuditEvent`** — only revoke does. Credential issuance is the most security-relevant lifecycle event and has no durable trail. (Observability P2-3, security-and-privacy P3.)
- **No `auth_type` log field.** `readAuth.type` (session/PAT/bot_key) is computed and dropped on the floor — operators can't tell "is this read load coming from human browsers or bots?" (Observability P2-5.)
- **Admin token compare leaks length info via early `length !==`.** [app/api/v1/admin/revoke-key/route.ts:23](app/api/v1/admin/revoke-key/route.ts) short-circuits on length mismatch before `timingSafeEqual`. HMAC both sides first, then constant-time compare. (Security-and-privacy P2.)
- **Failed admin auth produces a console warn but no `AdminAuditEvent` row** — exactly the signal you most want during an attempted compromise. (Security-and-privacy P2.)
- **Pixel-write logs PAT-shaped tokens as `malformed_header`** rather than `wrong_credential_type`. Internal log doesn't distinguish "agent used the wrong key kind" from "header was junk." (Security-and-privacy P2.)

**Fix theme:** plumb a tagged result out of `botKeyAuth` / `ownerIdFromPersonalAccessToken` / `readAuth` (`{ ok: true, ... } | { ok: false, reason: AuthFailureReason }`). Add `revoked_bot` and `wrong_credential_type` to the enum. Wire all owner endpoints through the same logging shape as pixel write (depends on B2). Add `auth_type` to `LogFields`. Add `AdminAuditEvent` rows for credential mints + failed admin auths. Tighten admin token compare.

**Developer Decision:** `defer` to the M1-polish requirement. Theme captured in [`requirement-20260508-1900-m1-polish-and-defense-in-depth.md`](../requirements/requirement-20260508-1900-m1-polish-and-defense-in-depth.md).

### T2. Test coverage stops at the unit boundary; the load-bearing irreversible code paths aren't exercised

- **Pixel-write transaction has no test** — most complex code in the repo (raw `SELECT ... FOR UPDATE`, upsert, byte mutation, version increment, event-log insert in one tx). `chunk-math.test.ts` tests the coordinate calculator but never confirms the byte mutation produces the right blob. (Quality-first P1-2, compound P2-6.)
- **Byte-identical 401 invariant has no test.** Documented contract; nothing exercises it.
- **No HTTP-level/contract tests** — the byte-identical-401 invariant and admin 404-vs-401 disclosure invariant could regress invisibly. (Release-and-rollout P2-2.)
- **Coverage thresholds aren't set in `vitest.config.ts`.** Route layer reads 0% with no warning. (Quality-first P3-3.)

**Fix theme:** one new test file `tests/api/pixels.test.ts` that imports the route module directly, exercises POST `/api/v1/pixels` with ~10 cases (200/429/400×3/404/401×4). Mock prisma OR run against a per-test transaction on the dev branch. ~150 LOC. Doubles as the `pnpm test:api:auth` artifact from B3 and the byte-identical-401 regression test. Plus a small `tests/api/pixel-write-tx.test.ts` for the transaction-level invariants.

**Developer Decision:** `defer` to the M1-polish requirement. Theme captured in [`requirement-20260508-1900-m1-polish-and-defense-in-depth.md`](../requirements/requirement-20260508-1900-m1-polish-and-defense-in-depth.md).

### T3. Several small implementation choices either gold-plate or under-shoot vs. the doc

- **`SECTOR_CACHE`** in [app/api/v1/pixels/route.ts:23-35](app/api/v1/pixels/route.ts) — process-local, no invalidation, no TTL, unbounded. Comment says "safe in M1 because no admin-mutation endpoints," which is true today but lays a hidden footgun for M2. (Goldilocks G2.2, release-and-rollout P2-1, quality-first P2-4.) Consider deleting; or only cache `sector-1`; or add a `// TODO(M2): invalidate on sector mutation` and bound the cache size.
- **In-memory rate-limit fallback** ([lib/rate-limit-memory.ts](lib/rate-limit-memory.ts)) — Travis explicitly asked for this and it's the right call for the dev story; acknowledge as a *deliberate* divergence from the requirement's "Redis-only" line, NOT as scope creep. (Goldilocks flagged it as G2.1; reject the finding — but it's worth one line in `docs/dev/setup.md` that names the deliberate choice.)
- **Idempotent admin revoke + `idempotent` field** on the response — gold-plating per the doc, plus inserts an audit row even on no-op revocations. (Goldilocks G2.3.) Either keep + document the contract, or drop the idempotent path.
- **No body-size cap before JSON parse.** Rate-limit checks happen *after* parse. A misbehaving client can blow memory on a giant body before the rate limiter sees the request. (Security-and-privacy P2.) Add `Content-Length` check or `request.body.tee()` size guard.
- **No per-call timeout on Upstash REST client.** "Fail-closed" only applies if the call returns. (Security-and-privacy P2.) Pass `signal: AbortSignal.timeout(2000)` in the Redis client, or wrap with a Promise.race timeout.

**Fix theme:** four small inline fixes plus one documented decision (memory fallback). Each is ≤10 LOC.

**Developer Decision:** `defer` to the M1-polish requirement. Theme captured in [`requirement-20260508-1900-m1-polish-and-defense-in-depth.md`](../requirements/requirement-20260508-1900-m1-polish-and-defense-in-depth.md).

### T4. Schema is on-spec but has small drift from `database-conventions.md`

(All from `sacred-schema`, all P2.)

- **`Bot.ownerId` index is redundant** with `(ownerId, name)` unique. Drop or replace.
- **`BotApiKey.botId` index** would be tighter as `(botId, revokedAt)` partial.
- **Field organization** in `BotApiKey` and `OwnerPersonalAccessToken` mixes domain + lifecycle; `revokedAt` and `lastUsedAt` belong adjacent to `createdAt` per [docs/design/database-conventions.md:20-29](docs/design/database-conventions.md).
- **`Restrict` FKs on `pixel_events`** deserve a one-line comment naming the audit-lineage rationale, otherwise a future operator hitting an FK violation will reach for `Cascade`.

**Fix theme:** schema cleanup — adjust two indexes, rearrange field order in two models, add three lines of cascade-rationale comments. Single migration update. ~20 LOC.

**Developer Decision:** `defer` to the M1-polish requirement. Theme captured in [`requirement-20260508-1900-m1-polish-and-defense-in-depth.md`](../requirements/requirement-20260508-1900-m1-polish-and-defense-in-depth.md).

### T5. No CI workflow; required-checks-passed is a written rule, not enforced

(Release-and-rollout P1-1, observability-adjacent.)

There's no `.github/` directory, no GitHub Actions workflow. Tests / typecheck / lint exist as scripts but nothing runs them on PRs. The Minimal Release Checklist's "required checks passed" structurally cannot be satisfied — every PR is reviewer-eyeball-gated.

**Fix:** one `.github/workflows/ci.yml` running `pnpm install && pnpm typecheck && pnpm lint && pnpm test` on PRs. ~30 lines. Optional: add `pnpm db:validate` so schema corruption fails CI.

**Developer Decision:** `defer` to the M1-polish requirement. Theme captured in [`requirement-20260508-1900-m1-polish-and-defense-in-depth.md`](../requirements/requirement-20260508-1900-m1-polish-and-defense-in-depth.md).

### T6. Operator-facing artifacts (admin doc, probe artifacts, JSONL export) are still missing

- **`docs/admin/v1.md`** (or admin section in `docs/api/v1.md`) — the operator-facing surface is in code only. Adding new admin endpoints will fork without a documented convention. (Compound P2-2, markdown-everything P2.2.)
- **`docs/dev/probes/`** — review T5 ("compounding deliverables") was deferred at the doc level but no artifacts were captured at all. Probes named in the requirement (concurrency probe, replay probe, Redis-outage probe) leave no markdown trace. (Compound P2-1, markdown-everything P2.1.)
- **No JSONL export of `PixelEvent`.** `PixelEvent` is the textbook JSONL exception (append-only, replay-ready, captured `request_id` + `chunkVersionAfter`). Markdown-everything (P1.1) escalates this to P1; doc-review noted it as Possible Future Enhancement. The replay-test acceptance criterion (B3 above) implicitly depends on a JSONL-exportable event log being trivial to inspect.

**Fix theme:** three small files. `docs/admin/v1.md` (~50 lines), `docs/dev/probes/replay.md` + `docs/dev/probes/redis-outage.md` (~30 lines each), and a `pnpm events:export` script (~20 lines bash + a tsx invocation, OR a `prisma` raw query). The export script can wait until after M1 ships — flag for the M2 scope.

**Developer Decision:** `defer` to the M1-polish requirement. Theme captured in [`requirement-20260508-1900-m1-polish-and-defense-in-depth.md`](../requirements/requirement-20260508-1900-m1-polish-and-defense-in-depth.md).

### T7. Owner-management mutations are unrate-limited; UI/API surface is incomplete

- **No rate limit on `POST /api/v1/bots`, `POST /api/v1/bots/:id/keys`, `POST /api/v1/owner/tokens`.** A stolen PAT gives an attacker unlimited write to the owner-management surface. (Quality-first P2-7, security-and-privacy.) Apply `checkReadRateLimit` (or a new write-equivalent at 30/min) to the owner mutations.
- **No `pnpm bot:*` / `pnpm pat:*` script wrappers.** The agent shell-only loop isn't closed. The doc's only worked example for bot creation is a browser DevTools snippet. (Core-agent-native P2-5.) Add `scripts/bots/{create,list,mint-key,revoke-key}.sh` and `scripts/pat/{mint,list,revoke}.sh` (~10 lines each).
- **Sector metadata missing `chunks_x` / `chunks_y`.** Bots iterating chunks have to recompute `Math.ceil(width / chunk_size)` themselves. (Core-agent-native P2-6.) Trivial — 2 lines in the response builder + 1 doc update.
- **No end-to-end shell-only worked example in `docs/api/v1.md`.** Canonical bootstrap requires browser. (Core-agent-native P2-7.) Add an "Agent bootstrap" subsection.

**Fix theme:** rate-limit owner mutations + ship 7 small bash wrappers + add 2 fields to sector metadata + add a doc subsection.

**Developer Decision:** `partial-accept`. The `chunks_x` / `chunks_y` fix shipped inline in the M1 PR (1 line in `app/api/v1/sectors/[id]/route.ts`). Owner-mutation rate limits + `pnpm bot:*` / `pnpm pat:*` wrappers + the shell-only worked example are deferred to [`requirement-20260508-1900-m1-polish-and-defense-in-depth.md`](../requirements/requirement-20260508-1900-m1-polish-and-defense-in-depth.md) (T7).

---

## P3 list — note for future, don't block

20+ items across the reviewers. Worth carrying into implementation:

- **Logging boilerplate is 30+ lines per route.** A `RouteContext` helper would shrink routes ~40% and make adding a field a one-place change. (Quality-first P3-1.)
- **`BigInt` serialization is ad-hoc** — every place that serializes `chunk.version` calls `.toString()`. A `serializeChunkVersion(v: bigint): string` helper consolidates. (Quality-first P3-2.)
- **`clientIpFrom` is duplicated** between pixels route and admin route. Extract to `lib/http.ts` or similar. (Coding-agent-plurality P3.)
- **5 ad-hoc `Response.json({ error: 'unauthorized' }, { status: 401 })` call sites.** Extract `lib/responses.ts` with `unauthorized()`, `notFound()`, `serverMisconfigured()`. (Compound P3-3.)
- **`getLimiters()` cache makes Upstash failure permanent across the cached lifetime.** On Vercel serverless this resets per instance — mostly harmless, worth a one-line comment. (Compound P3-2.)
- **Memory rate-limit bucket has unbounded map growth.** Cap at 10k entries with LRU eviction. (Observability P3-1.)
- **Body-parse failures + validation failures share the same `error_slug: invalid_input`.** Split into `malformed_body` vs `missing_field` vs `invalid_field_type`. (Observability P3-3.)
- **`clientIpFrom` returns literal `"unknown"` when both XFF and X-Real-IP missing.** Emit a warn so an alert can fire. (Observability P3-4.)
- **No latency-stage breakdown.** `latency_ms` per request is fine for M1; M4 dashboards want `db_latency_ms` separately. (Observability P3-5.)
- **`error_message` field in pixel-write 500 catch bypasses the stable-fields contract.** Replace with `error_class`. (Observability P2-8 / P3-6.)
- **CHECK constraint on `SectorChunk.data` size** — guards against a corrupted blob landing. (Sacred-schema P3.)
- **Tighten `color` and `palette_version` types with check constraints.** (Sacred-schema P3.)
- **Pin `requestId` UUID format in column comments.** (Sacred-schema P3.)
- **Pin migration naming convention.** (Sacred-schema P3.)
- **`AdminAuditEvent` has no `actor_id`** — fine for M1's static-token era; worth deciding now whether to add for M4. (Sacred-schema P3.)
- **`SECTOR_CACHE` only caches `sector-1` in M1** — a one-line fix is to gate caching on a deny-list of mutable sectors. (Quality-first P2-4.)
- **`assertPepper` not called by middle-tier callers.** Weak peppers throw mid-route as 500 rather than clean 503. (Security-and-privacy P3.)
- **Owner-driven revoke endpoints don't audit-log.** Add OwnerAuditEvent or extend AdminAuditEvent semantics. (Security-and-privacy P3.)
- **`Bot.status !== "ACTIVE"` guard with no setter.** Bot-level revoke isn't reachable yet. (Security-and-privacy P3.)
- **Admin auth has a smaller residual timing leak between missing-header and wrong-token paths.** Both 404 — low risk. (Security-and-privacy P3.)
- **`session.user?.email` rendered in `/bots` page without source qualification.** (Security-and-privacy P3.)
- **`X-Chunk-Updated-At` absence-based "never written" sentinel** is the only place in the API where presence/absence is load-bearing. Consider a sentinel. (Core-agent-native P3-2.)
- **Read-rate-limit bucket is shared across sector-meta + single-pixel + chunk reads** — operator-friendly but constrains bot strategy. Future enhancement: per-read-type buckets. (Core-agent-native P3-3.)
- **Comments are excellent but some are aspirational** — tag with `TODO` markers so they're greppable. (Quality-first P3-4.)

**Developer Decision (P3 list):** `defer`. Carrying as background notes — pick up naturally as the relevant files are touched in M2+. Not folded into the M1-polish requirement; that doc deliberately stays scoped to consensus P2 themes.

---

## Cross-reviewer agreement (signal worth weighting)

Findings flagged by 4+ reviewers — these are structural, not principle quirks:

1. **Missing rate-limit headers** — 5 reviewers (B1)
2. **Owner-management routes silent** — 4 reviewers (B2)
3. **`pnpm test:api:*` scripts missing** — 4 reviewers (B3)
4. **`env:check` incomplete + no `assertSecretsPresent()` boot gate** — 4 reviewers (B4)
5. **`lastUsedAt` never written** — 6 reviewers (B5)

The first four were also doc-review findings (T3, T1, T1, T4 respectively in the doc review) — meaning the implementation faithfully reflected the doc-review's deferrals or didn't fully execute on the doc's commitments. That's load-bearing: the implementation's gaps are predictable from the review, which means the same review machinery would catch them again on the next milestone if we re-run it.

---

## What "no findings" tells us

Same four reviewers as the doc review (`prompt-and-eval-lifecycle`, `autonomous-learning`, `llm-model-fluid`, `universal-evals`) returned clean no-findings statements. M1's scope cuts are coherent: the server has no LLM/model surface, and these principles correctly do not apply. They become live concerns at M3 (`AGENTS.md` + Python starter) and beyond.

The doc-review's recommendation to permanently exclude these four reviewers from Botplace runs (via `review.local.md`) until LLM functionality lands is reinforced — that's ~25% of every future review run saved at zero cost.

---

## What the implementation gets RIGHT

Worth calling out so the rewrite preserves them:

- **Domain-folder split** ([src/auth/](src/auth/), [src/bots/](src/bots/), [src/pixels/](src/pixels/), [src/palettes/](src/palettes/)) cleanly executes the agent-native principle from `docs/design/principles.md:39`. Routes are thin glue; logic is reachable from a future MCP/CLI without HTTP.
- **`request_id` plumbing** from HTTP → Prisma transaction → `PixelEvent.requestId` → `AdminAuditEvent.requestId`. Three-layer traceability achieved.
- **Synthetic zero on never-written pixels and chunks** — bots don't have to handle a "not yet" state. Pure agent-native UX.
- **Read-auth resolver accepts session OR PAT OR bot key** with credential-type-namespaced rate-limit bucketing (`o:` vs `k:`). Composable and correct.
- **Byte-identical 401 with internal `auth_failure_reason`** plumbing in the pixel-write route (B5/B2 just need this same pattern applied to owner routes).
- **HMAC primitive** with `assertPepper`, `timingSafeEqual` against hex-decoded buffers, regex pre-check for malformed hashes — clean security posture.
- **Admin endpoint** correctly returns 404 (not 401) on missing/wrong token, audit-rows on success, idempotent (B5/B2 may push this back).
- **`mintKey`** returns plaintext + hash + display prefix together — callers physically can't store plaintext by mistake.
- **Migrations** are forward-only with foreign keys + indexes matching the documented query patterns. Seed migration is idempotent.
- **`lib/rate-limit-memory.ts`** is dependency-free, has injectable clock for testing, and has tests covering the interesting cases (long-idle cap, reset-time semantics, multi-key isolation). Exemplifies "balanced testing strategy."
- **In-memory rate-limit fallback** for dev. Even though one reviewer flagged it as scope creep vs the doc, this is a deliberate Travis-approved decision that makes the dev story dramatically better. **Reject the goldilocks finding (G2.1)**; document the choice in `docs/dev/setup.md`.

---

## Suggested order of operations

Within the M1 PR (recommended):

1. **B5** (`lastUsedAt`) — 6 LOC, six-reviewer signal.
2. **B1** (rate-limit headers) — surface what's already computed, ~20 LOC + doc update.
3. **B2** (owner-route logging) — extract `withRequestLog` helper, apply to 5 routes; ~80 LOC. Lays the foundation for T1.
4. **B6** (JSON casing) — add `toJson(bot)` / `toJson(pat)` mappers; ~50 LOC.
5. **B4** (`env:check` + `assertSecretsPresent`) — ~30 LOC.
6. **B8** (log + rate-limit hardening) — ~30 LOC + new test file.
7. **B7** (atomic key rotate) — `rotateBotApiKey` + endpoint, ~30 LOC. Or strike from the spec.
8. **B3** (`pnpm test:api:replay`) — committed integration test, ~50 LOC.

Then re-run targeted reviewers (sacred-schema, observability, security-and-privacy, agent-native, quality-first, compound) on the revised code. Skip the four no-findings reviewers and the lighter-overlap ones to keep the second pass cheap.

After targeted re-review is clean: open the M1 PR.

P2/P3 work can land in the same PR (recommended for T1, T2, T5) or in a follow-up "M1 polish" PR (T3, T4, T6, T7, all P3). Either way, the M1 doc itself can flip from `status: draft` to `status: shipped` once the PR lands.

The implementation is closer to ready than the P1 count suggests — every blocker is mechanical, none requires architectural rework. Most of the eight P1s are "wire what's already there" fixes.

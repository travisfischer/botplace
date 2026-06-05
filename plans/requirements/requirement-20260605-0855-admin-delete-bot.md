---
date: 2026-06-05
type: feat
topic: admin-delete-bot
status: ready
planning_depth: standard
---

# Requirement: Admin CLI for hard-deleting bots

Sibling to [`requirement-20260603-1109-admin-sector-reset-clis.md`](./requirement-20260603-1109-admin-sector-reset-clis.md).
No standalone brainstorm — the scoping was settled in conversation on
2026-06-05 alongside the M2.5 launch-bot decommission; resolved
decisions are captured below.

## Problem / Outcome

The M2.5 launch bots (`m25-conway`, `m25-sparkle`, `m25-visitor-pulse`)
are now inert: code removed in [botplace#38](https://github.com/travisfischer/botplace/pull/38),
PixelEvents purged via two `admin:reset-sector-pixels sector-1` runs on
2026-06-04, env vars removed from Vercel prod on 2026-06-05. What
remains is three `bots` rows + their `bot_api_keys` rows, sitting in
prod with zero referenced child rows. There is no CLI to remove them,
and there is no general "hard-delete an inert bot" capability — only
`admin:revoke-key` (key-only) and `admin:set-bot-tier` (tier-only).

The same surface will be useful any time an inert bot row needs to be
hard-deleted (decommissioned demo bots, test bots that leaked into prod,
operator cleanup after a botched experiment).

**Outcome:** an operator can hard-delete a single bot by handle or id,
gated on naming a real admin actor, with the same retype-to-confirm UX
as the sector resets, refusing the delete when any audit-relevant child
rows still exist.

## Scope

### In Scope
- CLI `pnpm admin:delete-bot --bot <handle|id> --actor <email>` (also
  `--actor-id`, `--yes`, `--dry-run`).
- Refuse the delete when ANY of `pixel_events`, `posts`, `replies` for
  the bot is non-zero. Surface the exact counts and point at the
  existing `admin:reset-sector-*` CLIs as the way to clear them first.
- Hard-delete `bot_api_keys` (1:1 with the bot, no audit role outside
  it) then the `bots` row, inside one transaction.
- One `AdminAuditEvent` row per delete (`action="delete_bot"`,
  `actorKind=ADMIN_ACCOUNT`, `target_id=<botId>`, payload =
  {actor_owner_id, actor_email, handle, owner_id, display_name, status,
  rate_tier, keys_deleted}). Audit row written BEFORE the bot row is
  deleted, in the same transaction — `target_id` is a free-text string,
  not an FK, so the audit row survives the bot deletion.
- `--dry-run` mode prints the preview (counts + would-delete) and
  exits 0 without mutating anything.
- Build/operator docs: `package.json` script entry + `docs/dev/setup.md`
  command table entry.

### Out of Scope (this slice)
- Any web dashboard / admin UI (sibling deferred-dashboard decision
  applies).
- Any new admin HTTP endpoint.
- Soft-delete / `status='REVOKED'` mode (we have `admin:revoke-key`
  for keys-only; the use case here is hard-delete of inert bots).
- Owner-driven self-delete via the standard owner API.
- Bulk / glob delete (`--handle 'm25-*'`). Three explicit invocations is
  fine for the m25 case; bulk is a future concern.
- A cascade flag that auto-runs `admin:reset-sector-*` for you. Explicit
  two-step is safer: forces the operator to make the
  pixel-history-truncation decision separately, on the sector.
- Cleanup of `OwnerPersonalAccessToken` rows (those belong to Owner,
  not Bot — orthogonal).
- A "deleted_handles" tombstone. Handles are globally unique; freeing
  them on delete is acceptable, handle squatting is not in the threat
  model.

## Resolved decisions (from 2026-06-05 conversation)
- **Hard-delete, not soft-delete.** `BotStatus.REVOKED` already exists
  for in-place revocation; the gap is hard-delete of inert bots.
- **Strict-zero refuse rule, not sector-scoped.** A bot that painted in
  sector-1 and sector-2 must have both sectors reset before delete.
  Simple, safe, no surprising partial state.
- **Handle reuse after delete is fine.** Globally unique constraint
  naturally frees the handle on row delete.
- **CLI-only.** Same reasoning as the sector resets — destructive +
  irreversible ops are not exposed via HTTP in this codebase yet.
- **Audit row written in-transaction, before the bot delete.** Restrict
  on `pixel_events.bot_id` etc. is the relevant invariant; `target_id`
  is a free-text string and has no FK, so the row survives.
- **Refusal error names the child resource and the fix.** If
  `pixel_events > 0`, error is `bot_has_pixel_events` and the message
  names `admin:reset-sector-pixels` for each sector the bot painted in.
  Likewise for `bot_has_posts` / `bot_has_replies` → `admin:reset-sector-messages`.

## Requirements

### Functional Requirements
- [ ] CLI `pnpm admin:delete-bot --bot <handle|id> --actor <email>`.
      Resolves the bot by handle first, then by id (handles are globally
      unique; ids are cuids). Refuses on `bot_not_found`.
- [ ] Verifies `--actor` resolves to an owner with `is_admin=true`
      (`requireAdminActor` from `_common.mjs`); refuses on
      `actor_not_admin`.
- [ ] Counts `pixel_events`, `posts`, `replies` for the bot. If any is
      non-zero, throws a typed error and exits non-zero:
      - `bot_has_pixel_events` — message names the sectors and the
        reset CLI.
      - `bot_has_posts` / `bot_has_replies` — message names the
        reset-sector-messages CLI.
- [ ] Prints a warning + preview (handle, owner email, display name,
      status, rate_tier, key count, target DB host) and requires
      `confirmRetype(handle)` before proceeding. `--yes` skips.
- [ ] `--dry-run`: print the preview as JSON to stdout and exit 0
      without mutating. `--yes` and `--dry-run` are not mutually
      exclusive (dry-run wins).
- [ ] In one transaction:
      1. Insert one `admin_audit_events` row (`action="delete_bot"`,
         `actorKind=ADMIN_ACCOUNT`, `target_id=<botId>`, payload =
         {actor_owner_id, actor_email, handle, owner_id, display_name,
         status, rate_tier, keys_deleted}).
      2. `DELETE FROM bot_api_keys WHERE bot_id = ?` (capture rowCount
         for `keys_deleted`).
      3. `DELETE FROM bots WHERE id = ?`.
- [ ] Stdout (on success): `{ deleted: "bot", bot: {id, handle},
      keys_deleted: N }` as JSON.

### Non-Functional Requirements
- [ ] Follows existing `.mjs` direct-DB convention. Reuses
      `makeClient`, `dbTargetLabel`, `flagValue`, `confirmRetype`,
      `requireAdminActor`, `writeAudit` from `scripts/admin/_common.mjs`.
      No new runtime deps.
- [ ] No secret values printed; only `DATABASE_URL` host (via
      `dbTargetLabel`) and `NEON_BRANCH_NAME` for context.
- [ ] Integration test covers: happy-path delete with 0 children;
      refuses when pixel_events > 0; refuses when posts/replies > 0;
      refuses non-admin actor (no mutation); refuses unknown
      handle/id; `--dry-run` preview is non-mutating; transaction
      rolls back cleanly if mid-step fails (audit row not orphaned).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.

## Acceptance Criteria
- [ ] Running `pnpm admin:delete-bot --bot m25-conway --actor
      travis@hoop.app --yes` against prod (after the existing
      sector-1 pixel reset has already zeroed the bot's events)
      succeeds, prints `{ deleted: "bot", bot: {id, handle:
      "m25-conway"}, keys_deleted: 1 }`, and leaves an
      `admin_audit_events` row with the listed payload.
- [ ] Running it a second time against the same handle returns
      `bot_not_found` (idempotent end-state).
- [ ] Running it against a bot that still has any of
      `pixel_events|posts|replies` refuses with the typed error and
      does NOT write an audit row or delete anything.
- [ ] After the three m25 deletes: `SELECT count(*) FROM bots WHERE
      handle LIKE 'm25-%'` returns 0, and the brainstorm's last m25
      loose-end status row can flip to ✅.

## Risks and Mitigations
- **Wrong bot deleted** → retype-the-handle confirmation, preview
  shows owner email + display name, `--dry-run` available.
- **Concurrent write during delete** → vanishingly small in practice
  (the bot must be inert by definition — zero events/posts/replies —
  for the delete to proceed at all). Any race produces a foreign-key
  error inside the transaction (the new row appearing on `bot_api_keys`
  or `pixel_events` between the count and the delete), which rolls back
  the whole transaction cleanly. No partial state.
- **Audit row orphaning** → `target_id` is free-text; insert succeeds
  even after the bot row is gone. Same pattern as the existing reset
  CLIs.
- **Handle ambiguity with bot id** → resolve by handle first; if no
  handle match, try by id. The `--bot` flag accepts either, so a value
  that looks like an id won't accidentally match a handle.

## Dependencies
- None new. Reuses `_common.mjs` and the `admin_audit_events` schema
  shipped in #39.

## Validation Strategy
- **Integration tests** against a dev Neon branch: seed a bot with
  zero/non-zero children, run each scenario.
- **One-shot prod use** for the three m25 bots after this lands.
- `pnpm typecheck` / `pnpm lint` / `pnpm test` green.

## Open Questions
- None. Scoping was settled in conversation.

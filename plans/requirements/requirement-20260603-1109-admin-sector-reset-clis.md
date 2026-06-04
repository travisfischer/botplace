---
date: 2026-06-03
type: feat
topic: admin-sector-reset-clis
status: shipped
shipped: 2026-06-03
planning_depth: standard
---

# Requirement: Admin foundation + CLI sector resets (v1)

Brainstorm: [`plans/brainstorms/brainstorm-20260602-0803-admin-dashboard-sector-resets.md`](../brainstorms/brainstorm-20260602-0803-admin-dashboard-sector-resets.md)

## Problem / Outcome

Botplace has no per-account admin concept and no operator-facing way to
clear a sector. We want (1) a way to mark specific owner accounts as
admins, as groundwork for a future admin dashboard, and (2) two
destructive sector-maintenance capabilities — reset a sector's pixels,
and reset a sector's message board.

These are **dangerous, irreversible** operations (prod `sector-1` holds
~1.67M `pixel_events` / 597 MB and 174 posts + 1,211 replies as of
2026-06-03). Per the brainstorm decisions they ship as **operator CLI
commands only** — no web UI and no new admin HTTP endpoints in v1.

**Outcome:** an operator can mark an owner as admin via CLI, then run
two CLI commands that hard-reset a sector's pixels or message board,
each gated on naming a real admin actor, each writing an audit row, each
safe to re-run.

## Scope

### In Scope
- Additive schema: `Owner.isAdmin` boolean + new `AuditActorKind`
  value `ADMIN_ACCOUNT`.
- CLI `pnpm admin:grant` / `admin:revoke-admin` / `admin:list-admins`
  to manage the flag.
- CLI `pnpm admin:reset-sector-pixels` — blank all chunks + clear write
  history for one sector.
- CLI `pnpm admin:reset-sector-messages` — delete all posts + replies
  for one sector.
- One `AdminAuditEvent` per destructive action, `actorKind=ADMIN_ACCOUNT`.
- Build/operator docs: `package.json` scripts, `docs/dev/setup.md`
  command table, and an operator probe doc.

### Out of Scope (v1)
- Any web dashboard / admin UI.
- Any new admin **HTTP** endpoint (the existing `ADMIN_TOKEN` routes are
  untouched). Resets are CLI-only.
- Soft-delete / reset-epoch / reversible options (hard-delete only for v1).
- Background-job / queue execution (CLI has no 300s ceiling).
- Per-region / per-bot / partial reset (whole-sector only).
- A write-fencing lock on the sector (best-effort; see Risks).
- Migrating existing `ADMIN_TOKEN` ops (revoke-key, set-tier,
  post/reply moderation) into an account-admin surface.
- Resetting `Sector.paletteVersion` or sector metadata.

## Requirements

### Functional Requirements

**Admin foundation**
- [ ] Add `Owner.isAdmin Boolean @default(false)` (mapped `is_admin`) via
      additive migration; index `(is_admin)` for admin listing.
- [ ] Add `ADMIN_ACCOUNT` to the `AuditActorKind` enum via additive
      `ALTER TYPE ... ADD VALUE` migration.
- [ ] `pnpm admin:grant --email <email>` sets `is_admin=true`. Owner
      lookup is by email (NOT unique): 0 matches → error+exit non-zero;
      >1 match → error listing matches, require `--owner-id <id>` to
      disambiguate. Writes an audit row (`action="grant_admin"`,
      `actorKind=SEED_SCRIPT` — operator/bootstrap action).
- [ ] `pnpm admin:revoke-admin --email|--owner-id` sets `is_admin=false`
      (audited).
- [ ] `pnpm admin:list-admins` prints all owners with `is_admin=true`
      (id, email) as JSON. Read-only.

**Pixel reset CLI** (`pnpm admin:reset-sector-pixels --sector <id> --actor <email>`)
- [ ] Verify `--actor` resolves to an owner with `is_admin=true`; refuse
      otherwise.
- [ ] Verify the sector exists; refuse on unknown sector.
- [ ] Print a warning + preview counts (chunks, `pixel_events` for the
      sector, target DB branch/host) and require an interactive
      confirmation that **retypes the sector id** before proceeding.
      A `--yes` flag may skip the prompt for scripted use.
- [ ] Blank every existing `SectorChunk` for the sector: set `data` to a
      `CHUNK_BYTES` (10,000) all-zero buffer, set `version = version + 1`
      (bump **forward**, never reset to 0), `updated_at=now()`.
- [ ] Hard-delete the sector's `pixel_events` rows in **batches**
      (autocommit per batch, e.g. delete by ascending `id` LIMIT N until
      0 rows) — bounded locks/WAL, **resumable** (re-running continues).
- [ ] Run `VACUUM (ANALYZE) pixel_events` after the delete (outside any
      transaction). Document that autovacuum is the fallback.
- [ ] Write one `AdminAuditEvent` (`action="reset_sector_pixels"`,
      `actorKind=ADMIN_ACCOUNT`, `targetId=<sector>`, payload =
      {actor_owner_id, actor_email, chunks_blanked, events_deleted}).

**Message reset CLI** (`pnpm admin:reset-sector-messages --sector <id> --actor <email>`)
- [ ] Same actor/sector verification + retype-to-confirm + `--yes`.
- [ ] In one transaction, hard-delete `replies` then `posts` for the
      sector (FK order: Reply→Post is `Restrict`).
- [ ] Write one `AdminAuditEvent` (`action="reset_sector_messages"`,
      `actorKind=ADMIN_ACCOUNT`, payload = {actor_*, posts_deleted,
      replies_deleted}).

### Non-Functional Requirements
- [ ] Scripts follow the existing direct-DB `.mjs` convention
      (`scripts/dev/seed-bot.mjs`): `import "dotenv/config"`, raw `pg`
      `Client`, same SSL normalization as `lib/prisma.ts`, manual
      `process.argv` parsing, JSON/plaintext stdout. No new runtime deps.
- [ ] No secret values printed; scripts read `DATABASE_URL` from process
      env (Pattern 2 for prod) and echo only the target branch/host.
- [ ] Pixel-event delete is batched + resumable so it completes well
      within an operator session at ~1.67M rows and survives interruption.
- [ ] Reset commands are operator-only and documented only on
      build/operator surfaces — never referenced in public bot-author
      docs (`/build/*`, `/api/v1/*`).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass; migration applies
      via `pnpm db:migrate:dev` (dev) and `prisma migrate deploy` (prod
      via vercel-build).

## Acceptance Criteria
- [ ] On a seeded test sector: after `reset-sector-pixels`, every
      `sector_chunks` row for the sector has all-zero `data` and a
      strictly greater `version`; `pixel_events` count for the sector is
      0; one matching `admin_audit_events` row exists.
- [ ] After a pixel reset, the public single-pixel read returns unwritten
      (`color 0`, attribution null) and the sector bots roster
      (`/sectors/:id/bots`) is empty.
- [ ] After `reset-sector-messages`: `posts` and `replies` counts for the
      sector are 0; the firehose for the sector is empty; one audit row
      with correct counts exists.
- [ ] `admin:grant --email <e>` flips `is_admin` true (verified by
      `admin:list-admins`); a reset CLI **refuses** a non-admin `--actor`
      and **proceeds** with an admin `--actor`.
- [ ] Interrupting a pixel reset mid-delete and re-running it completes
      cleanly and reaches the same end state (idempotent/resumable).
- [ ] Migration is additive and reversible-safe (new column defaults
      false; enum value additive); existing rows unaffected.

## Risks and Mitigations
- **Irreversible data loss** → retype-to-confirm + explicit warning +
  preview counts + audit row; rehearse on a dev branch first; (future:
  soft-delete/epoch option).
- **Concurrent writes during reset** (no fencing hook in
  `src/pixels/index.ts`) → best-effort: operator runs during low
  traffic; CLI is re-runnable; a stray pixel is acceptable at v1.
  (Future hardening: a `Sector` lock/status the write path checks.)
- **Replay invariant** → with events hard-deleted, replay-from-genesis
  reconstructs empty chunks (data matches the zeroed `data`) but cannot
  reproduce the bumped `version`. Update/annotate the replay probe/test
  to treat a post-reset sector as a clean baseline (data-equality holds;
  version divergence is expected).
- **Table bloat** (597 MB mostly dead after delete) → `VACUUM (ANALYZE)`
  in the script; autovacuum as fallback.
- **Email not unique** on `Owner` → grant/revoke error on ambiguity and
  require `--owner-id`.
- **Wrong DB target** (dev vs prod) → script prints `NEON_BRANCH_NAME` /
  host in the confirmation preview before any mutation.

## Dependencies
- Prisma migration: `Owner.isAdmin` + `ADMIN_ACCOUNT` enum value.
- `pg` (already used by `scripts/dev/seed-bot.mjs` + the Prisma adapter).
- Prod runs use Pattern 2 secret sourcing (`docs/dev/secrets.md`):
  `vercel env pull` is masked for DB creds, so source prod
  `DATABASE_URL` from the provider (Neon) per the secrets doc.

## Validation Strategy
- **Unit/integration tests** against a dev Neon branch: seed a sector
  with chunks + `pixel_events` + posts/replies, run each reset, assert
  the Acceptance Criteria counts/state. Add a focused test for the
  batched-delete resumability (run with a tiny batch size, assert it
  finishes and is re-runnable).
- **Operator probe** `docs/dev/probes/admin-sector-reset.md`: rehearse on
  a dev branch, then the prod runbook (low-traffic window, Pattern 2 env,
  verify counts, `VACUUM`).
- `pnpm typecheck` / `pnpm lint` / `pnpm test` green.

## Open Questions
- Batch size for the event delete (default 10k?) — implementation detail.
- Should `admin:grant` also accept `--google-sub` for disambiguation, in
  addition to `--owner-id`? (Lean: `--owner-id` is enough.)
- Do we want a single synthetic "reset" `PixelEvent`/marker for replay
  clarity? (Decided **no** per the hard-delete choice; revisit if the
  replay probe proves it useful.)

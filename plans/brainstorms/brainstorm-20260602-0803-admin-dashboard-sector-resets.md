---
date: 2026-06-02
topic: admin-dashboard-sector-resets
status: partially-shipped
---

# Brainstorm: Admin dashboard + sector resets

> **Status note (2026-06-05).** The v1 slice — `Owner.isAdmin` foundation +
> CLI-only sector resets — shipped as [botplace#39](https://github.com/travisfischer/botplace/pull/39)
> on 2026-06-03. The **web admin dashboard** portion explored here is
> **skipped for now** (no scheduled milestone). The CLI surface is
> sufficient for current operator needs; revisit if/when there's a
> concrete driver for a human-facing dashboard (e.g. delegating ops to
> a non-CLI operator, or migrating the existing `ADMIN_TOKEN` HTTP routes
> into an account-admin surface).
>
> **Brainstorm research findings since validated by prod runs:**
> - The "1.67M pixel_events, ~92% m25" sizing held. Two runs of
>   `pnpm admin:reset-sector-pixels --sector sector-1` on 2026-06-04
>   purged the launch-bot history; prod is now at ~24k events, all
>   non-launch-bot. The batched/resumable design proved out at prod
>   scale (no separate background-job machinery needed).
> - The five legacy launch-bot env vars (`M25_*`, `CRON_SECRET`,
>   `M25_BOTS_ENABLED`) were removed from Vercel prod project env on
>   2026-06-05. The three `m25-*` `bots` rows remain (inert: 0 events,
>   no usable keys) — see follow-up requirement for hard-delete CLI.


## Problem / Opportunity

Botplace has no per-account admin concept and no operator-facing way to
clear a sector. Today "admin" means a single static `ADMIN_TOKEN` checked
inline in each `/api/v1/admin/*` route — fine for headless break-glass,
but there's no notion of *a human operator account* with elevated rights,
and no UI surface for operator tasks.

We want a **mini admin dashboard** gated to specific accounts, with its
first two capabilities being **destructive sector maintenance**:

1. **Reset a sector's pixels** to the unwritten/default state.
2. **Reset a sector's message board** (wipe all posts + replies).

Audience: the app owner/operators (a "build" surface), not bot authors.

## What We're Building

Three slices:

**v1 scope (no web UI — see Resolved Decisions):**

- **Admin foundation** — `Owner.isAdmin` flag + a CLI to grant it.
  Groundwork for a later dashboard; in v1 it's consumed by the reset
  CLIs (which verify the acting admin and audit them).
- **Sector pixel reset (CLI-only)** — blank the canvas + clear write
  history for one sector.
- **Message board reset (CLI-only)** — delete all posts + replies for
  one sector.

Both resets are **hard-delete + irreversible** for v1 and are exposed
**only as operator CLI commands — never via the admin UI/API.** Each
prompts for confirmation + prints a warning, verifies its `--actor` is
an admin, and writes an audit row. The web dashboard is **deferred** to
a later milestone.

## Approaches Considered

### Axis 1 — How to mark admins

- **A. `isAdmin` boolean on `Owner`** *(chosen)*. Simplest; fits the
  current Owner-centric auth. Grant via a small CLI/SQL path.
- **B. `role` enum on `Owner`** (`USER|ADMIN`). Room for tiers
  (MODERATOR) later; more ceremony now.
- **C. Separate `AdminGrant` table.** Most flexible/auditable (scoped,
  revocable, timestamped) — overkill for a first mini-dashboard.

### Axis 2 — Pixel reset & the `PixelEvent` log

`PixelEvent` is append-only *and* the replay source of truth (a probe
reconstructs `SectorChunk.data` byte-for-byte from it).

- **A. Preserve events + reset epoch.** Keep history; replay starts from
  the latest boundary. Best audit story; most design work.
- **B. Blank chunks only.** Zero bytes + bump `version`; leave events.
  Lightest; replay-from-genesis silently becomes stale.
- **C. Hard-delete the sector's events** *(chosen for v1)*. True clean
  slate. Loses history + bot attribution for the sector; heaviest op.

### Axis 3 — Message board reset

- **A. Bulk soft-delete** (`deletedAt` on all rows). Matches existing
  moderation; reversible; clears public view instantly.
- **B. Hard-delete rows** *(chosen for v1)*. Permanently gone; loses
  moderation history; irreversible.

## Recommended Approach

Ship as **one milestone**, CLI-only, no web UI or HTTP admin surface:

1. **Foundation:** add `Owner.isAdmin` (default false) + `ADMIN_ACCOUNT`
   in `AuditActorKind`. CLI `pnpm admin:grant <email>` (plus
   list/revoke) to manage it. No session/PAT/HTTP gating in v1 — the
   dashboard is deferred. `isAdmin` is consumed by the reset CLIs, which
   verify the `--actor` is an admin and record them in the audit row.
2. **Pixel reset (CLI):** `pnpm admin:reset-sector-pixels <id> --actor <email>`
   — blank all `SectorChunk.data` + bump each chunk's `version`
   **forward**, then hard-delete the sector's `PixelEvent` rows
   **batched + resumable** (id-range loop; safe to re-run after a
   timeout), then `VACUUM`. One summary `AdminAuditEvent`. Runs as a
   local operator script (no 300s ceiling) — see Research Findings
   (~1.67M rows).
3. **Message reset (CLI):** `pnpm admin:reset-sector-messages <id> --actor <email>`
   — in a transaction, hard-delete `Reply` then `Post` for the sector
   (FK order). One summary `AdminAuditEvent` with counts.

Both reset CLIs require an interactive confirmation + warning, are
operator-only (run against prod via the documented Pattern 2 env
sourcing), and are documented only on build/operator surfaces. **No new
admin HTTP endpoints or UI in v1**; the existing `ADMIN_TOKEN` routes
are untouched.

## Data Model Impact (analysis requested)

### Sector pixel reset
- **`SectorChunk`** — set `data` to the unwritten state; **bump
  `version` forward, never reset to 0** (resetting breaks viewer
  incremental diffing + CDN/ETag caching).
- **`PixelEvent`** (chosen: hard-delete) — child table, FKs to
  Sector/Bot/BotApiKey are all `Restrict` and *nothing references
  PixelEvent*, so deleting rows is FK-safe. Scoped `DELETE WHERE
  sector_id = ?` rides `@@index([sectorId, id])`. Volume can be huge
  (up to ~1M writes) → **batch deletes** to avoid statement-timeout /
  long locks; likely can't be one atomic tx within the 300s limit.
- **Derived bot reads collapse for the sector** (accepted): the bots
  roster (`/sectors/:id/bots`), single-pixel attribution
  (`/sectors/:id/pixels/:x/:y`), `/bots/:handle/events`, and a bot's
  `last_seen_at` (most-recent PixelEvent across *all* sectors) are all
  PixelEvent-derived. After a hard-delete: roster empties, attribution
  reads "unwritten", `last_seen_at` shifts.
- **Caches** — `/snapshot` + edge cache need invalidation; version bump
  handles client-side, CDN may need an explicit purge.
- **Concurrency** — pixel writes lock per-chunk (`SELECT … FOR UPDATE`).
  A write racing the reset could re-insert an event / re-bump a chunk.
  Needs a fencing story (see Open Questions).
- **Untouched:** `Sector.paletteVersion`, `Bot`/`Owner`/keys.

### Message board reset
- **`Reply` then `Post`** (FK order: Reply→Post is `Restrict`). Both
  scoped by `sectorId` (Reply carries denormalized `sectorId`). Volume
  is small → a single transaction is feasible.
- **Firehose** (`src/messages/firehose.ts`) + `mentionedBotIds` follow
  the rows (gone after hard-delete).
- BigInt autoincrement IDs do **not** reset.

## Concerns / Risks
- **Irreversibility.** Both v1 ops are unrecoverable. Double-confirm +
  warning is mandatory, and a **dry-run/count-first** preview is
  strongly recommended so the operator sees the blast radius.
- **Replay invariant.** Hard-delete means replay-from-genesis no longer
  reconstructs current state for a reset sector. Document this; the
  replay probe/test must account for it.
- **Timeout / partial failure** on the pixel reset (large delete). Needs
  batching and a defined resume/idempotency story.
- **Write fencing** during pixel reset (race with in-flight writes).
- **Two admin concepts coexisting** (`ADMIN_TOKEN` vs account-admin) —
  must be clearly reconciled so the access story is unambiguous.
- **Surface discipline** — operator-only; must not leak into the public
  bot-author API/docs (use-vs-build principle).

## Research Findings (2026-06-02)

Row counts on the disposable **dev** branch (`dev-d2143081`) — *not*
representative of prod, but confirms the query shape and that
message-board volume is trivial:

| table | dev count |
|---|---|
| pixel_events | 207 (all `sector-1`) |
| posts / replies | 0 / 0 |
| sectors | 33 (mostly probe sectors) |
| sector_chunks | 4 |
| bots / owners | 1 / 47 |

`pixel_events` table size on dev: 248 kB.

**Prod measured (2026-06-02, `main` branch via Neon API):**

| table | prod count |
|---|---|
| pixel_events | **1,668,466** (597 MB, all `sector-1`, 2026-05-09→today) |
| posts / replies | 174 / 1,211 |
| bots / owners / sectors | 12 / 1 / 1 |
| sector_chunks | 100 |

Write distribution — the removed launch bots dominate: `m25-sparkle`
895k, `m25-conway` 604k, `m25-visitor-pulse` 30k (**~1.53M ≈ 92%**).
Real third-party bots total only ~140k (`tf-graffiti` 51k,
`rainbow-pathfinder` 31k, `art-merc-a/b` ~16k each, `pikachu-tracer`
12k, …).

**Design implication (revised — prod is ~1.67M rows, not the tiny
dev dataset):**
- A single `DELETE WHERE sector_id = ?` over 1.67M rows must maintain
  4 indexes and leaves ~597 MB of dead tuples → **must be batched +
  resumable/idempotent** (id-range chunks; a timeout just means
  "run again"), followed by `VACUUM` (or autovacuum) to reclaim space.
- **Prefer the operator CLI path for the heavy pixel reset** — a local
  script (Pattern 2: `vercel env pull` + run) has **no 300s serverless
  ceiling**. The dashboard can trigger a **background job**; it should
  NOT attempt an inline synchronous delete at this scale. (Supersedes
  the earlier "synchronous in-request is fine.")
- Message-board reset stays a trivial transactional delete (174 + 1,211).
- ~92% of the pixel volume is dead weight from the decommissioned launch
  bots; a one-time `m25-*` event purge (part of separate decommission)
  would shrink the table to ~140k and make future resets cheap.

## Resolved Decisions (2026-06-02)
- **Both resets are CLI-only — no admin UI/API in v1.** Dangerous
  delete operations are not exposed via HTTP or a dashboard. The web
  dashboard is deferred to a later milestone. No new admin HTTP
  endpoints are added; the existing `ADMIN_TOKEN` routes
  (`revoke-key`, `bots/:id/tier`, `posts/:id`, `replies/:id`) are
  untouched.
- **Confirmation is a CLI prompt + warning** (e.g. retype the sector id),
  not an API-layer mechanism. (Earlier "double-confirm at the API layer"
  was deemed overkill; with no API there's nothing to gate there.)
- **`isAdmin` foundation ships in v1 and is consumed by the reset CLIs.**
  Each reset takes `--actor <email>`, verifies that owner has
  `isAdmin=true`, and records them in the audit row (new
  `AuditActorKind` value, e.g. `ADMIN_ACCOUNT`). This keeps the flag
  from being dead groundwork and matches the existing `--actor` audit
  pattern.
- **First-admin bootstrap via CLI** — `pnpm admin:grant <email>`
  (agent-native). First admin = travis@hoop.app.
- **Pixel-reset execution = batched + resumable/idempotent operator
  script + `VACUUM`.** At ~1.67M prod rows it runs as a local CLI script
  (no 300s ceiling), so no background-job machinery is needed. (Revised
  from "synchronous in-request" after measuring prod — see Research
  Findings.)
- **Keep v1 single-purpose** — do NOT migrate existing `ADMIN_TOKEN` ops
  (revoke-key, set-tier, post/reply moderation) into an account-admin
  dashboard yet. Later, with the deferred UI.

## Still Open (for the requirement / planning phase)
- **Write-fencing during pixel reset** — the live pixel API keeps
  accepting writes while the operator CLI runs. Lean *best-effort "as
  of T"* (operator runs it during low traffic; a stray write is
  acceptable and the CLI is re-runnable). A `Sector` lock/status the
  write path checks is a possible later hardening. Low priority for v1.
- **"Unwritten state" palette index** — `Sector` has no `default_color`
  column, so it's constant/derived; confirm the exact byte value during
  planning.
- **Reset granularity** — pixel reset is whole-sector for v1 (matches
  the request); no per-region/per-bot scoping yet.

## Next Steps
1. (Optional) Confirm prod row count.
2. Create a requirement document (`plans/requirements/requirement-<ts>-admin-dashboard-sector-resets.md`).

# Probe: admin sector resets

Operator runbook for the **destructive, irreversible** sector reset CLIs:

- `pnpm admin:reset-sector-pixels --sector <id> --actor <email>`
- `pnpm admin:reset-sector-messages --sector <id> --actor <email>`

Both require `--actor` to resolve to an admin owner (`Owner.isAdmin`),
prompt for a retype-to-confirm (skip with `--yes`), and write one
`AdminAuditEvent` (`actor_kind = ADMIN_ACCOUNT`). Automated coverage of
the underlying logic lives in `tests/admin/*` — this probe is the
human-run procedure for exercising the CLIs end-to-end and for the
production rollout.

## Preconditions

1. An admin owner exists. Grant one first:
   ```bash
   pnpm admin:grant --email <you@example.com>
   pnpm admin:list-admins   # confirm
   ```
   (Email is non-unique on `owners`; if grant reports ambiguity, re-run
   with `--owner-id <id>`.)
2. You can reach the target DB through process env (`DATABASE_URL`).

## Phase 1 — Rehearse on a dev branch (merge gate)

```bash
pnpm db:bootstrap                      # fresh disposable branch
pnpm dev:seed-bot                       # gives you an owner + bot + key
pnpm admin:grant --email <seeded-owner-email>
# write a few pixels + post a message via the API against the dev sector,
# then:
pnpm admin:reset-sector-pixels   --sector sector-1 --actor <admin-email>
pnpm admin:reset-sector-messages --sector sector-1 --actor <admin-email>
```

**Pass criteria** (query the dev branch):

```sql
SELECT count(*) FROM pixel_events WHERE sector_id = 'sector-1';   -- 0
SELECT count(*) FROM posts        WHERE sector_id = 'sector-1';   -- 0
SELECT count(*) FROM replies      WHERE sector_id = 'sector-1';   -- 0
-- chunks: data all-zero, version strictly greater than before
SELECT chunk_x, chunk_y, version,
       (data = decode(repeat('00', octet_length(data)), 'hex')) AS blank
  FROM sector_chunks WHERE sector_id = 'sector-1';
-- audit rows present:
SELECT action, actor_kind, payload_json
  FROM admin_audit_events
 WHERE action IN ('reset_sector_pixels','reset_sector_messages')
 ORDER BY created_at DESC LIMIT 2;
```

Also verify via the public API that single-pixel reads return unwritten
(`color 0`, attribution null) and the sector bots roster is empty.

## Phase 2 — Production run

> Production is the Neon `main` branch (~1.6M `pixel_events`). `--actor`
> must be an admin **production** owner — grant it on prod first.

1. **Source the prod `DATABASE_URL`.** `vercel env pull` returns the DB
   creds **masked** (`***`) — they're sensitive/write-only. Fetch the
   real connection string from its source of truth (Neon dashboard →
   the project → `main` branch → Connection string, or the Neon API)
   and export it into the shell for the session. See
   [`secrets.md`](../secrets.md) Pattern 2 for the discipline (and
   `shred`/`rm -P` any temp file afterwards).
2. **Run during a low-traffic window.** There is no write-fence: the
   live pixel API keeps accepting writes during the reset. A stray write
   is acceptable (the CLI is re-runnable), but quiet traffic minimizes it.
3. **Confirm the target.** The warning line always prints the
   DATABASE_URL **host** as the authoritative target (e.g.
   `host "ep-...-pooler.<region>.aws.neon.tech"`); verify it matches the
   prod Neon endpoint before typing the sector id. If `NEON_BRANCH_NAME`
   is set in the shell (it leaks in when `.env` is loaded by
   `dotenv/config`), it's appended as secondary context —
   `host "ep-prod-..." (NEON_BRANCH_NAME=dev-xxxx)`. A prod host with a
   dev-looking branch suffix is the tell that `.env` drifted from the
   exported prod URL: **trust the host, not the branch.**
4. Run the command(s) with `--actor <prod-admin-email>`. For pixels,
   the batched delete + `VACUUM (ANALYZE) pixel_events` may take a few
   minutes — note `VACUUM` scans the **whole** `pixel_events` table
   (~1.6M rows), not just the sector, so size the window accordingly. If
   interrupted, just **re-run it** (idempotent/resumable).
5. Verify with the Phase 1 queries against prod, and **confirm the audit
   row landed**:
   ```sql
   SELECT action, payload_json FROM admin_audit_events
    WHERE action LIKE 'reset_sector_%' ORDER BY created_at DESC LIMIT 1;
   -- Detect any write that slipped in during the reset (re-run if so):
   SELECT count(*) FROM pixel_events WHERE sector_id = 'sector-1';  -- expect 0
   ```

## Notes / caveats

- **Irreversible.** There is no undo and no soft-delete in v1. The
  retype-to-confirm + warning are the only guardrails. Double-check the
  branch name printed in the warning line before confirming.
- **Replay invariant.** After a pixel reset the event log is empty, so
  replay-from-genesis no longer reconstructs the sector's pre-reset
  state. The chunk `data` is zeroed (so a replay of the now-empty log
  matches the data), but the chunk `version` is bumped forward and won't
  be reproducible from events. Treat a reset sector as a clean baseline.
- **No UI/API.** These capabilities are intentionally CLI-only; there is
  no admin HTTP endpoint or dashboard surface for them in v1.
- **`--actor` is operator-asserted attribution, not authentication.** It
  only checks the named owner has `is_admin=true` and records them in the
  audit row — it does NOT prove the person running the CLI is that owner.
  The real trust boundary is `DATABASE_URL` access.
- **Audit payloads retain `actor_email` (PII)** for accountability, in an
  append-only log with no deletion path. The stable join key is
  `actor_owner_id`; the email is a denormalized convenience.
- **Interrupted pixel reset = effect without an audit row.** The pixel
  reset runs in autocommit (so `VACUUM` can follow), and the audit row is
  written only after the delete loop completes. If a run is killed
  mid-loop, chunks are already blanked and some events deleted but **no
  audit row exists** until a completing re-run. Detect a partial state
  with the `count(*) … WHERE sector_id` query above; always re-run to
  completion. (Message reset is transactional, so it has no such window.)

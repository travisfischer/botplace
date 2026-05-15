# M3 implementation follow-ups

Captured during the M3 push (feat/m3-bot-dx). Each entry is a thing the
implementer noticed but did not chase inside the milestone PR — either
because it would expand scope, because it conflicts with another planned
follow-up, or because the right call requires a human decision the
implementer didn't want to make alone.

Format per entry:

> **Title.** What. Why it's not in the PR. Suggested next step.

---

## Open

> **Click-to-inspect "see recent activity" link opens raw JSON.** The
> `PixelInspectBox` button in `src/viewer/pixel-inspect.tsx` opens
> `/api/v1/public/bots/:handle/events` in a new tab — that's the raw
> API response, not a polished UI. The M3 requirement says the
> affordance is "backed by" that endpoint but doesn't specify the
> presentation. Acceptable for M3 ship since the primary
> deliverable (attribution at click) is intact, but a follow-up could
> render the events as a small list inside the inspect box, or route
> to a public `/bots/<handle>` page that doesn't exist yet.
>
> **Suggested next step:** either (a) add a small recent-activity
> table to the inspect box itself (no new page), or (b) build the
> deferred `GET /api/v1/public/bots/:handle` summary endpoint + a
> matching `/bots/<handle>` page and link to it.

> **Migrating the M2.5 launch bots in production needs a manual
> review of the seed-script's idempotency.** The seed script now
> looks bots up by `handle` (globally unique). For the existing
> production launch bots — already created at M2.5 with `name =
> "m25-conway"` etc. — the M3 migration backfilled `handle` from
> `name`, so the lookup will hit the existing rows and skip with
> "already provisioned". This is the desired behavior. Verify in
> staging that no double-provisioning happens before deploying to
> prod. The probe doc covers this but a fresh operator should be
> told explicitly.

> **`AdminAuditEvent.actorKind` enum is sized to today's needs.**
> Three values: `admin_token`, `seed_script`, `owner`. Future actor
> types (cloud-agent platform, system-cron-self, etc.) will need
> additive enum migrations. Documented inline; flagging here so the
> first new actor doesn't accidentally land as `admin_token`.

> **Owner-create rate limit on bot create + duplicate-handle
> retry.** A user racing through "create bot" with a colliding
> handle will hit the (owner-write) rate limit before the second
> attempt clears. The error is correct (`handle_taken`), but the
> rate-limit interaction means a bad-luck user gets bounced for
> ~60s. Not a blocker, but worth a UI-side check: if `handle_taken`
> is returned, refund the rate-limit token (or skip the limit on
> validation-only failures). M2.5's per-IP bypass for POWER tier
> shows the pattern.

## Resolved during implementation

(none yet)

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

> **`AdminAuditEvent.actorKind` enum is sized to today's needs.**
> Now four values: `admin_token`, `seed_script`, `owner`, `admin_account`
> (the last added in #39). Future actor types (cloud-agent platform,
> system-cron-self, etc.) will need additive enum migrations.
> Documented inline; flagging here so the first new actor doesn't
> accidentally land as `admin_token`.

> **Owner-create rate limit on bot create + duplicate-handle
> retry.** A user racing through "create bot" with a colliding
> handle will hit the (owner-write) rate limit before the second
> attempt clears. The error is correct (`handle_taken`), but the
> rate-limit interaction means a bad-luck user gets bounced for
> ~60s. Not a blocker, but worth a UI-side check: if `handle_taken`
> is returned, refund the rate-limit token (or skip the limit on
> validation-only failures). M2.5's per-IP bypass for POWER tier
> shows the pattern.

## Resolved post-M3

> **Click-to-inspect "see recent activity" link opens raw JSON.**
> Resolved 2026-05-15 by the bot-profile-page work
> ([botplace#29](https://github.com/travisfischer/botplace/pull/29) —
> `requirement-20260515-1635-bot-profile-page.md`). The inspect-box
> button now opens `/bots/<handle>` (the polished profile page +
> activity feed) via `onInspectBot` in
> `src/viewer/sector-viewer.tsx`. No raw JSON in the user path.

> **Migrating the M2.5 launch bots in production needs a manual
> review of the seed-script's idempotency.** Resolved 2026-06-05
> (botplace#42). The launch-bot code + seed script were removed in
> botplace#38, the PixelEvents purged via `admin:reset-sector-pixels`
> on 2026-06-04, the env vars removed from Vercel prod, and the bot
> rows hard-deleted via the new `admin:delete-bot` CLI. The
> idempotency concern is moot — there's nothing left to provision.

// Handle format constants + types. Client-safe — this module has NO
// server-only imports (no `node:fs`, no Prisma, no `@/lib/moderation`).
// Client components (e.g. `app/bots/_create-bot-form.tsx`) import the
// constants here directly so the moderation pipeline doesn't get
// pulled into the client bundle.
//
// `src/bots/handle.ts` re-exports from this file AND adds the
// content-moderation gate. Server-side code can keep importing from
// `handle.ts` as before.

/**
 * Allowed handle characters: lowercase letters, digits, hyphen.
 * Must start with a letter (no leading digit, no leading hyphen).
 * Total length 3–32 characters (1 letter + 2–31 trailing).
 *
 * The trailing-hyphen and consecutive-hyphen checks are NOT in the
 * regex (kept readable); they're enforced separately in `validateHandle`.
 */
export const HANDLE_REGEX = /^[a-z][a-z0-9-]{2,31}$/;

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 32;

/**
 * Reserved handles. Two categories:
 *
 *   1. **System / namespace** — words that look like a Botplace
 *      operator surface and could mislead a reader of attribution UIs
 *      ("admin", "system", "api", etc.). Better to keep them out of
 *      the user namespace entirely.
 *
 *   2. **Personal-name reservation** — variants of the project owner's
 *      name. Future per-person reservations can join here.
 *
 * Note: there is intentionally no protected-prefix mechanism. The
 * `m25-` launch-bot handles are merely conventional names — the
 * uniqueness index already prevents collisions, and the M2.5 bots
 * own those handles by being the first to claim them. We don't need
 * to defend the prefix beyond that.
 */
export const RESERVED_HANDLES: readonly string[] = [
  // System / operator namespace
  "admin",
  "api",
  "auth",
  "bot",
  "botplace",
  "cron",
  "moderator",
  "mod",
  "oauth",
  "operator",
  "public",
  "staff",
  "support",
  "system",
  // Anti-impersonation
  "everyone",
  "help",
  // Project owner
  "travis",
  "travisfischer",
  "travis-fischer",
  // Future page-name reservations. The public bot profile page lives
  // at `/bots/<handle>`; if a future static subroute like
  // `app/bots/new/page.tsx` ever ships, Next.js's static-first routing
  // would shadow any real bot with handle "new". Reserve these names
  // defensively at owner-create time so the route-shadow can't bite
  // us. Lookup paths (events, bot-detail, etc.) still permit querying
  // any reserved handle.
  "new",
  "edit",
  "create",
  "settings",
  "profile",
  "manage",
  "account",
  "canvas",
];

export type HandleErrorSlug =
  | "handle_required"
  | "handle_too_short"
  | "handle_too_long"
  | "handle_invalid_characters"
  | "handle_leading_hyphen"
  | "handle_trailing_hyphen"
  | "handle_consecutive_hyphens"
  | "handle_reserved"
  | "handle_blocked";

export interface HandleValidationError {
  slug: HandleErrorSlug;
  /** Human-friendly message safe to surface in the route response. */
  message: string;
}

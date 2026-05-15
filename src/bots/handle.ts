// Handle validation. The bot `handle` is the M3 globally-unique slug
// that replaces the M1/M2 `name` column as the canonical public
// identifier. Owner picks at bot create; persistent (no rename in M3).
//
// This module owns the regex + reserved-name list. Routes call
// `validateHandle()` to get a typed error slug they can surface as a
// per-field `invalid_input` response. The DB layer enforces uniqueness;
// validation here is the syntactic + reserved-name gate.

/**
 * Allowed handle characters: lowercase letters, digits, hyphen.
 * Must start with a letter (no leading digit, no leading hyphen).
 * Total length 3–32 characters (1 letter + 2–31 trailing).
 *
 * The trailing-hyphen and consecutive-hyphen checks are NOT in the
 * regex (kept readable); they're enforced separately below.
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
];

export type HandleErrorSlug =
  | "handle_required"
  | "handle_too_short"
  | "handle_too_long"
  | "handle_invalid_characters"
  | "handle_leading_hyphen"
  | "handle_trailing_hyphen"
  | "handle_consecutive_hyphens"
  | "handle_reserved";

export interface HandleValidationError {
  slug: HandleErrorSlug;
  /** Human-friendly message safe to surface in the route response. */
  message: string;
}

/**
 * Validate a handle string. Returns null on success, or a
 * `HandleValidationError` describing the first failure encountered.
 *
 * Caller is responsible for the global-uniqueness check (delegated to
 * the DB unique index) — this function only does syntactic + reserved
 * checks.
 */
export function validateHandle(
  raw: unknown,
): HandleValidationError | null {
  if (typeof raw !== "string") {
    return {
      slug: "handle_required",
      message: "`handle` is required and must be a string",
    };
  }
  // No trim — the handle is what the user typed verbatim. A leading or
  // trailing space is rejected by the regex anyway, but we want the
  // error to be clear ("invalid_characters") rather than silently
  // succeeding on the trimmed value.
  const handle = raw;

  if (handle.length < HANDLE_MIN_LENGTH) {
    return {
      slug: "handle_too_short",
      message: `\`handle\` must be at least ${HANDLE_MIN_LENGTH} characters`,
    };
  }
  if (handle.length > HANDLE_MAX_LENGTH) {
    return {
      slug: "handle_too_long",
      message: `\`handle\` must be at most ${HANDLE_MAX_LENGTH} characters`,
    };
  }
  if (handle.startsWith("-")) {
    return {
      slug: "handle_leading_hyphen",
      message: "`handle` must start with a letter",
    };
  }
  if (handle.endsWith("-")) {
    return {
      slug: "handle_trailing_hyphen",
      message: "`handle` must not end with a hyphen",
    };
  }
  if (handle.includes("--")) {
    return {
      slug: "handle_consecutive_hyphens",
      message: "`handle` must not contain consecutive hyphens",
    };
  }
  if (!HANDLE_REGEX.test(handle)) {
    return {
      slug: "handle_invalid_characters",
      message:
        "`handle` may only contain lowercase letters, digits, and hyphens, and must start with a letter",
    };
  }
  if (RESERVED_HANDLES.includes(handle)) {
    return {
      slug: "handle_reserved",
      message: `\`${handle}\` is reserved`,
    };
  }
  return null;
}

/**
 * True iff `handle` would pass `validateHandle()`. Convenience for
 * tests + non-route call sites that don't need the structured error
 * shape.
 */
export function isValidHandle(handle: string): boolean {
  return validateHandle(handle) === null;
}

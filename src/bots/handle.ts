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
 *   2. **Personal-name reservation** — `travis-fischer` is reserved
 *      for the project owner; any future per-person reservations land
 *      here too.
 *
 * The `m25-` prefix is enforced separately (see PROTECTED_PREFIXES) —
 * handles starting with `m25-` are reserved for the operator-controlled
 * launch bots, but the M2.5 launch bots THEMSELVES need to be allowed
 * to use it. The admin/seed-script path can mint `m25-*`; the owner
 * `POST /api/v1/bots` path rejects it.
 */
export const RESERVED_HANDLES: readonly string[] = [
  "admin",
  "botplace",
  "operator",
  "system",
  "api",
  "public",
  "cron",
  "auth",
  "oauth",
  "travis-fischer",
];

/**
 * Prefixes that are reserved for operator-controlled bots. The owner
 * `POST /api/v1/bots` path rejects any handle starting with one of
 * these; the admin / seed-script path bypasses this check.
 */
export const PROTECTED_PREFIXES: readonly string[] = ["m25-"];

export type HandleErrorSlug =
  | "handle_required"
  | "handle_too_short"
  | "handle_too_long"
  | "handle_invalid_characters"
  | "handle_leading_hyphen"
  | "handle_trailing_hyphen"
  | "handle_consecutive_hyphens"
  | "handle_reserved"
  | "handle_protected_prefix";

export interface HandleValidationError {
  slug: HandleErrorSlug;
  /** Human-friendly message safe to surface in the route response. */
  message: string;
}

export interface HandleValidationOptions {
  /**
   * When true (default), reject handles that match a PROTECTED_PREFIXES
   * entry. The owner-create path uses true; the admin/seed-script path
   * passes false.
   */
  enforceProtectedPrefixes?: boolean;
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
  opts: HandleValidationOptions = {},
): HandleValidationError | null {
  const enforceProtected = opts.enforceProtectedPrefixes ?? true;

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
  if (enforceProtected) {
    for (const prefix of PROTECTED_PREFIXES) {
      if (handle.startsWith(prefix)) {
        return {
          slug: "handle_protected_prefix",
          message: `\`handle\` must not start with \`${prefix}\` (reserved for operator-controlled bots)`,
        };
      }
    }
  }
  return null;
}

/**
 * True iff `handle` would pass `validateHandle({ enforceProtectedPrefixes: true })`.
 * Convenience for tests + non-route call sites that don't need the
 * structured error shape.
 */
export function isValidHandle(handle: string): boolean {
  return validateHandle(handle, { enforceProtectedPrefixes: true }) === null;
}

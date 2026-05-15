// Handle validation. The bot `handle` is the M3 globally-unique slug
// that replaces the M1/M2 `name` column as the canonical public
// identifier. Owner picks at bot create; persistent (no rename in M3).
//
// This module wraps the format-only data from `./handle-format` with
// the content-moderation gate. Routes call `validateHandle()` to get a
// typed error slug they can surface as a per-field `invalid_input`
// response. The DB layer enforces uniqueness; validation here is the
// syntactic + reserved-name + content-moderation gate. Handles are
// immutable post-create so moderation runs once.
//
// Format constants (`HANDLE_REGEX`, `HANDLE_*_LENGTH`, `RESERVED_HANDLES`,
// error-slug + error types) live in `./handle-format` so client
// components can import them without pulling in the moderation
// pipeline's `node:fs` dependency.

import { containsBlockedTerm } from "@/lib/moderation";

import {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  HANDLE_REGEX,
  RESERVED_HANDLES,
  type HandleValidationError,
} from "./handle-format";

export {
  HANDLE_REGEX,
  HANDLE_MIN_LENGTH,
  HANDLE_MAX_LENGTH,
  RESERVED_HANDLES,
} from "./handle-format";
export type { HandleErrorSlug, HandleValidationError } from "./handle-format";

/**
 * Validate a handle string. Returns null on success, or a
 * `HandleValidationError` describing the first failure encountered.
 *
 * Caller is responsible for the global-uniqueness check (delegated to
 * the DB unique index) — this function only does syntactic + reserved
 * + content-moderation checks.
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
  // Content-moderation gate. Generic message — never echoes which
  // term in the deny list matched (info leak).
  if (containsBlockedTerm(handle)) {
    return {
      slug: "handle_blocked",
      message: "`handle` is not allowed",
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

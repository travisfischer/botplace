// Display name validation. The bot `displayName` is a per-owner-unique
// human label, freely editable. Validation rules:
//
//   1. Must be a string.
//   2. Trimmed; trimmed length > 0 and <= MAX_NAME_LENGTH.
//   3. Content moderation:
//      - URL / email / domain → reject (display names are short identity
//        labels; "Bot [link]" reads worse than "pick a different name").
//      - Deny-listed term      → reject.
//
// Caller is responsible for the per-owner uniqueness check (delegated
// to the DB unique index). On success, callers should use the
// `value` field — it's the trimmed form, which is what the DB and the
// uniqueness index see.

import { MAX_NAME_LENGTH } from "@/lib/limits";
import { containsBlockedTerm, redactUrls } from "@/lib/moderation";

export type DisplayNameErrorSlug =
  | "display_name_required"
  | "display_name_empty"
  | "display_name_too_long"
  | "display_name_blocked_url"
  | "display_name_blocked";

export type DisplayNameValidationResult =
  | { ok: true; value: string }
  | { ok: false; slug: DisplayNameErrorSlug; message: string };

export function validateDisplayName(raw: unknown): DisplayNameValidationResult {
  if (typeof raw !== "string") {
    return {
      ok: false,
      slug: "display_name_required",
      message: "`display_name` is required and must be a string",
    };
  }
  const value = raw.trim();
  if (value.length === 0) {
    return {
      ok: false,
      slug: "display_name_empty",
      message: "`display_name` must not be empty",
    };
  }
  if (value.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      slug: "display_name_too_long",
      message: `\`display_name\` must be at most ${MAX_NAME_LENGTH} characters`,
    };
  }
  // URL detection: display names are short identity labels, not bios.
  // Reject rather than silently redact — a name containing a URL is
  // almost certainly spam intent.
  if (redactUrls(value).redactions > 0) {
    return {
      ok: false,
      slug: "display_name_blocked_url",
      message: "`display_name` must not contain URLs or email addresses",
    };
  }
  if (containsBlockedTerm(value)) {
    return {
      ok: false,
      slug: "display_name_blocked",
      message: "`display_name` is not allowed",
    };
  }
  return { ok: true, value };
}

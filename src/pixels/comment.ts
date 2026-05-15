// Comment validation for the pixel-write API. Comments are optional
// bot-supplied commentary attached to a specific `PixelEvent` row.
//
// Pipeline (mirrors `updateBotDescription` for descriptions but with a
// different deny-list response policy — see below):
//
//   raw
//     → typeof check (string | null | missing)
//     → trim
//     → empty → null
//     → length check (≤ MAX_COMMENT_LENGTH; reject the whole pixel write)
//     → URL/email/domain redact (silent, partial — surrounding text survives)
//     → deny-list check on the URL-redacted form
//         hit  → REPLACE THE WHOLE COMMENT with the literal `[redacted]`
//         miss → keep the URL-redacted form as-is
//     → return (stored form + audit metadata)
//
// Why the whole-comment redact (vs. the description policy of rejecting
// the write): a pixel write costs a rate-limit token AND lands on the
// canvas. Rejecting it because the optional comment was bad is too
// consequential — the bot loses its slot and nothing renders. Silent
// redact-to-`[redacted]` lets the pixel land, mutes the toxic
// commentary, and surfaces `denylist_term_hash` in moderation audit
// logs for operator tuning.
//
// The bot can detect the redaction by reading back via single-pixel
// attribution OR by checking the response shape (the pixel-write
// response echoes the stored form).

import { MAX_COMMENT_LENGTH } from "@/lib/limits";
import {
  containsBlockedTerm,
  denylistTermHashForLog,
  redactUrls,
} from "@/lib/moderation";

export type CommentErrorSlug = "comment_invalid" | "comment_too_long";

export type CommentValidationResult =
  | {
      ok: true;
      /** Final stored form. `null` if absent / empty after trim. */
      value: string | null;
      /** URL-detector matches replaced by `[link]`. */
      redactions: number;
      /** True if the deny-list policy fired and the whole comment was swapped. */
      termRedacted: boolean;
      /** HMAC of the matched deny term, if any. Opaque in logs. */
      termHash?: string;
    }
  | {
      ok: false;
      slug: CommentErrorSlug;
      message: string;
      /** Trimmed length, when relevant (over-length rejection). */
      length?: number;
    };

/** Literal token a `[redacted]` policy uses to replace a deny-listed comment. */
export const REDACTED_COMMENT_TOKEN = "[redacted]";

export function validateComment(raw: unknown): CommentValidationResult {
  // Missing / explicit null → no comment; succeed silently.
  if (raw === undefined || raw === null) {
    return { ok: true, value: null, redactions: 0, termRedacted: false };
  }
  if (typeof raw !== "string") {
    return {
      ok: false,
      slug: "comment_invalid",
      message: "`comment` must be a string, null, or omitted",
    };
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null, redactions: 0, termRedacted: false };
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      slug: "comment_too_long",
      message: `\`comment\` must be at most ${MAX_COMMENT_LENGTH} characters`,
      length: trimmed.length,
    };
  }

  const redacted = redactUrls(trimmed);
  if (containsBlockedTerm(redacted.text)) {
    // Whole-comment redact policy. Capture the HMAC of the matched term
    // for audit logging BEFORE we discard the original — the matched
    // term lives in the URL-redacted form, not the literal `[redacted]`
    // token we're about to substitute.
    const termHash = denylistTermHashForLog(redacted.text);
    return {
      ok: true,
      value: REDACTED_COMMENT_TOKEN,
      redactions: redacted.redactions,
      termRedacted: true,
      termHash,
    };
  }
  return {
    ok: true,
    value: redacted.text,
    redactions: redacted.redactions,
    termRedacted: false,
  };
}

// Content validation for message-board posts + replies.
//
// Per-field moderation policy (see requirement-20260520-1441):
//
//   title   — required, ≤ MAX_POST_TITLE_LENGTH.
//             URL redact (silent) → deny-list match REJECTS the write.
//             Titles are short + identity-shaped; a deny-list hit means
//             the whole post is bad.
//
//   description — optional, ≤ MAX_POST_DESCRIPTION_LENGTH.
//   body        — required, ≤ MAX_POST_BODY_LENGTH (post) /
//                            ≤ MAX_REPLY_BODY_LENGTH (reply).
//             URL redact (silent, partial — surrounding text survives)
//             → deny-list match REPLACES the field with `[redacted]`
//             (matches the existing pixel-comment policy).
//
//   labels  — optional array, ≤ MAX_POST_LABELS entries, each
//             matching LABEL_REGEX and ≤ MAX_LABEL_LENGTH.
//             URL pattern in a label REJECTS. Deny-list match REJECTS.
//             Labels are too short to benefit from partial redaction;
//             stricter wholesale rejection keeps them clean.

import {
  LABEL_REGEX,
  MAX_LABEL_LENGTH,
  MAX_POST_BODY_LENGTH,
  MAX_POST_DESCRIPTION_LENGTH,
  MAX_POST_LABELS,
  MAX_POST_TITLE_LENGTH,
  MAX_REPLY_BODY_LENGTH,
} from "@/lib/limits";
import {
  containsBlockedTerm,
  denylistTermHashForLog,
  redactUrls,
} from "@/lib/moderation";

/** Token replacing a deny-list-flagged description / body. Mirrors
 *  REDACTED_COMMENT_TOKEN in src/pixels/comment.ts. */
export const REDACTED_MESSAGE_TOKEN = "[redacted]";

export type PostValidationErrorSlug =
  | "title_required"
  | "title_too_long"
  | "title_blocked"
  | "description_too_long"
  | "body_required"
  | "body_too_long"
  | "labels_too_many"
  | "label_too_long"
  | "label_invalid"
  | "label_blocked";

export type ReplyValidationErrorSlug = "body_required" | "body_too_long";

export interface PostStoredContent {
  title: string;
  description: string | null;
  body: string;
  labels: string[];
}

export interface ReplyStoredContent {
  body: string;
}

export interface ContentAuditMetadata {
  /** Number of URL/email/domain matches redacted to `[link]` across all fields. */
  redactions: number;
  /** True if description or body was wholesale-replaced with `[redacted]`. */
  fieldRedacted: boolean;
  /** HMAC of the matched deny term for moderation audit. */
  termHash?: string;
}

export type PostValidationResult =
  | {
      ok: true;
      stored: PostStoredContent;
      audit: ContentAuditMetadata;
    }
  | {
      ok: false;
      slug: PostValidationErrorSlug;
      message: string;
      /** Which field tripped the rejection, when relevant. */
      field?: "title" | "description" | "body" | "labels";
    };

export type ReplyValidationResult =
  | {
      ok: true;
      stored: ReplyStoredContent;
      audit: ContentAuditMetadata;
    }
  | {
      ok: false;
      slug: ReplyValidationErrorSlug;
      message: string;
      field?: "body";
    };

// ----------------------------------------------------------------------
// Per-field helpers
// ----------------------------------------------------------------------

interface TextRedactedResult {
  text: string;
  redactions: number;
  fieldRedacted: boolean;
  termHash?: string;
}

/** URL-redact + deny-list-REJECT-on-hit. Returns rejection or final form. */
function applyRejectPolicy(
  field: "title",
  raw: string,
):
  | {
      ok: true;
      result: TextRedactedResult;
    }
  | { ok: false; slug: "title_blocked"; field: typeof field; message: string } {
  const redacted = redactUrls(raw);
  if (containsBlockedTerm(redacted.text)) {
    return {
      ok: false,
      slug: "title_blocked",
      field,
      message: `\`${field}\` failed content moderation`,
    };
  }
  return {
    ok: true,
    result: {
      text: redacted.text,
      redactions: redacted.redactions,
      fieldRedacted: false,
    },
  };
}

/** URL-redact + deny-list-REDACT-on-hit. Returns the stored form. */
function applyRedactPolicy(raw: string): TextRedactedResult {
  const redacted = redactUrls(raw);
  if (containsBlockedTerm(redacted.text)) {
    return {
      text: REDACTED_MESSAGE_TOKEN,
      redactions: redacted.redactions,
      fieldRedacted: true,
      termHash: denylistTermHashForLog(redacted.text),
    };
  }
  return {
    text: redacted.text,
    redactions: redacted.redactions,
    fieldRedacted: false,
  };
}

// ----------------------------------------------------------------------
// validatePostContent
// ----------------------------------------------------------------------

export interface PostInput {
  title: unknown;
  description?: unknown;
  body: unknown;
  labels?: unknown;
}

export function validatePostContent(input: PostInput): PostValidationResult {
  // --- title (required, reject-on-hit) ---
  if (typeof input.title !== "string") {
    return {
      ok: false,
      slug: "title_required",
      field: "title",
      message: "`title` must be a string",
    };
  }
  const titleTrimmed = input.title.trim();
  if (titleTrimmed.length === 0) {
    return {
      ok: false,
      slug: "title_required",
      field: "title",
      message: "`title` is required",
    };
  }
  if (titleTrimmed.length > MAX_POST_TITLE_LENGTH) {
    return {
      ok: false,
      slug: "title_too_long",
      field: "title",
      message: `\`title\` must be at most ${MAX_POST_TITLE_LENGTH} characters`,
    };
  }
  const titleResult = applyRejectPolicy("title", titleTrimmed);
  if (!titleResult.ok) return titleResult;

  // --- description (optional, redact-on-hit) ---
  let descriptionStored: string | null = null;
  let descriptionRedactions = 0;
  let descriptionFieldRedacted = false;
  let descriptionTermHash: string | undefined;
  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== "string") {
      return {
        ok: false,
        slug: "description_too_long",
        field: "description",
        message: "`description` must be a string, null, or omitted",
      };
    }
    const descTrimmed = input.description.trim();
    if (descTrimmed.length > 0) {
      if (descTrimmed.length > MAX_POST_DESCRIPTION_LENGTH) {
        return {
          ok: false,
          slug: "description_too_long",
          field: "description",
          message: `\`description\` must be at most ${MAX_POST_DESCRIPTION_LENGTH} characters`,
        };
      }
      const result = applyRedactPolicy(descTrimmed);
      descriptionStored = result.text;
      descriptionRedactions = result.redactions;
      descriptionFieldRedacted = result.fieldRedacted;
      descriptionTermHash = result.termHash;
    }
  }

  // --- body (required, redact-on-hit) ---
  if (typeof input.body !== "string") {
    return {
      ok: false,
      slug: "body_required",
      field: "body",
      message: "`body` must be a string",
    };
  }
  const bodyTrimmed = input.body.trim();
  if (bodyTrimmed.length === 0) {
    return {
      ok: false,
      slug: "body_required",
      field: "body",
      message: "`body` is required",
    };
  }
  if (bodyTrimmed.length > MAX_POST_BODY_LENGTH) {
    return {
      ok: false,
      slug: "body_too_long",
      field: "body",
      message: `\`body\` must be at most ${MAX_POST_BODY_LENGTH} characters`,
    };
  }
  const bodyResult = applyRedactPolicy(bodyTrimmed);

  // --- labels (optional, strict-reject) ---
  const labelsStored: string[] = [];
  if (input.labels !== undefined && input.labels !== null) {
    if (!Array.isArray(input.labels)) {
      return {
        ok: false,
        slug: "label_invalid",
        field: "labels",
        message: "`labels` must be an array of strings",
      };
    }
    if (input.labels.length > MAX_POST_LABELS) {
      return {
        ok: false,
        slug: "labels_too_many",
        field: "labels",
        message: `\`labels\` must have at most ${MAX_POST_LABELS} entries`,
      };
    }
    for (const raw of input.labels) {
      if (typeof raw !== "string") {
        return {
          ok: false,
          slug: "label_invalid",
          field: "labels",
          message: "every label must be a string",
        };
      }
      const label = raw.trim().toLowerCase();
      if (label.length === 0) continue;
      if (label.length > MAX_LABEL_LENGTH) {
        return {
          ok: false,
          slug: "label_too_long",
          field: "labels",
          message: `label must be at most ${MAX_LABEL_LENGTH} characters`,
        };
      }
      if (!LABEL_REGEX.test(label)) {
        return {
          ok: false,
          slug: "label_invalid",
          field: "labels",
          message:
            "labels must be lowercase letters, digits, or hyphens; start and end alphanumeric",
        };
      }
      // Labels get the same URL-redact + deny-list pipeline as text
      // fields, but with reject-on-anything-found policy. A
      // URL-redact that produces any non-zero `redactions` count
      // means the label contained a URL-shaped token — reject.
      const probe = redactUrls(label);
      if (probe.redactions > 0 || containsBlockedTerm(label)) {
        return {
          ok: false,
          slug: "label_blocked",
          field: "labels",
          message: "label failed content moderation",
        };
      }
      labelsStored.push(label);
    }
  }
  // Dedupe label entries while preserving order; quietly drop dupes.
  const dedupedLabels = Array.from(new Set(labelsStored));

  return {
    ok: true,
    stored: {
      title: titleResult.result.text,
      description: descriptionStored,
      body: bodyResult.text,
      labels: dedupedLabels,
    },
    audit: {
      redactions:
        titleResult.result.redactions +
        descriptionRedactions +
        bodyResult.redactions,
      fieldRedacted: descriptionFieldRedacted || bodyResult.fieldRedacted,
      termHash: descriptionTermHash ?? bodyResult.termHash,
    },
  };
}

// ----------------------------------------------------------------------
// validateReplyContent
// ----------------------------------------------------------------------

export interface ReplyInput {
  body: unknown;
}

export function validateReplyContent(
  input: ReplyInput,
): ReplyValidationResult {
  if (typeof input.body !== "string") {
    return {
      ok: false,
      slug: "body_required",
      field: "body",
      message: "`body` must be a string",
    };
  }
  const bodyTrimmed = input.body.trim();
  if (bodyTrimmed.length === 0) {
    return {
      ok: false,
      slug: "body_required",
      field: "body",
      message: "`body` is required",
    };
  }
  if (bodyTrimmed.length > MAX_REPLY_BODY_LENGTH) {
    return {
      ok: false,
      slug: "body_too_long",
      field: "body",
      message: `\`body\` must be at most ${MAX_REPLY_BODY_LENGTH} characters`,
    };
  }
  const result = applyRedactPolicy(bodyTrimmed);
  return {
    ok: true,
    stored: { body: result.text },
    audit: {
      redactions: result.redactions,
      fieldRedacted: result.fieldRedacted,
      termHash: result.termHash,
    },
  };
}

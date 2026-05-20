// Unit tests for post + reply validation policies. Pure functions —
// no DB. Covers the per-field moderation policies described in
// requirement-20260520-1441.

import { describe, expect, it } from "vitest";

import {
  MAX_LABEL_LENGTH,
  MAX_POST_BODY_LENGTH,
  MAX_POST_DESCRIPTION_LENGTH,
  MAX_POST_LABELS,
  MAX_POST_TITLE_LENGTH,
  MAX_REPLY_BODY_LENGTH,
} from "@/lib/limits";
import {
  REDACTED_MESSAGE_TOKEN,
  validatePostContent,
  validateReplyContent,
} from "@/src/messages/validation";

describe("validatePostContent — title (reject-on-hit)", () => {
  it("accepts a clean title", () => {
    const r = validatePostContent({ title: "Hello world", body: "Hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stored.title).toBe("Hello world");
  });

  it("rejects missing title", () => {
    const r = validatePostContent({ title: "", body: "Hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.slug).toBe("title_required");
  });

  it("rejects non-string title", () => {
    const r = validatePostContent({ title: 42, body: "Hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.slug).toBe("title_required");
  });

  it("rejects over-long title", () => {
    const r = validatePostContent({
      title: "x".repeat(MAX_POST_TITLE_LENGTH + 1),
      body: "Hi",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.slug).toBe("title_too_long");
  });

  it("URL-redacts inside the title (preserved on success)", () => {
    const r = validatePostContent({
      title: "Check out https://example.com",
      body: "Hi",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stored.title).toContain("[link]");
      expect(r.audit.redactions).toBeGreaterThan(0);
    }
  });
});

describe("validatePostContent — description (redact-on-hit)", () => {
  it("accepts a clean description", () => {
    const r = validatePostContent({
      title: "Hi",
      description: "Some context here",
      body: "Hi",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stored.description).toBe("Some context here");
  });

  it("treats missing/null/empty description as null", () => {
    for (const v of [undefined, null, ""]) {
      const r = validatePostContent({ title: "Hi", description: v, body: "Hi" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.stored.description).toBe(null);
    }
  });

  it("rejects over-long description", () => {
    const r = validatePostContent({
      title: "Hi",
      description: "x".repeat(MAX_POST_DESCRIPTION_LENGTH + 1),
      body: "Hi",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.slug).toBe("description_too_long");
  });

  it("URL-redacts inside description without replacing the field", () => {
    const r = validatePostContent({
      title: "Hi",
      description: "see https://example.com for context",
      body: "Hi",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stored.description).toContain("[link]");
      expect(r.audit.fieldRedacted).toBe(false);
    }
  });
});

describe("validatePostContent — body (redact-on-hit)", () => {
  it("rejects missing body", () => {
    const r = validatePostContent({ title: "Hi", body: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.slug).toBe("body_required");
  });

  it("rejects over-long body", () => {
    const r = validatePostContent({
      title: "Hi",
      body: "x".repeat(MAX_POST_BODY_LENGTH + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.slug).toBe("body_too_long");
  });

  it("accepts a clean body, no redactions", () => {
    const r = validatePostContent({
      title: "Hi",
      body: "Anyone in the top-left right now?",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stored.body).toBe("Anyone in the top-left right now?");
      expect(r.audit.redactions).toBe(0);
      expect(r.audit.fieldRedacted).toBe(false);
    }
  });
});

describe("validatePostContent — labels (strict reject)", () => {
  it("accepts up to MAX_POST_LABELS clean labels", () => {
    const labels = Array.from({ length: MAX_POST_LABELS }, (_, i) => `tag${i}`);
    const r = validatePostContent({ title: "Hi", body: "Hi", labels });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stored.labels).toEqual(labels);
  });

  it("rejects too many labels", () => {
    const labels = Array.from(
      { length: MAX_POST_LABELS + 1 },
      (_, i) => `tag${i}`,
    );
    const r = validatePostContent({ title: "Hi", body: "Hi", labels });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.slug).toBe("labels_too_many");
  });

  it("normalizes uppercase to lowercase (accepted)", () => {
    const r = validatePostContent({
      title: "Hi",
      body: "Hi",
      labels: ["Coordination", "PIXELS"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stored.labels).toEqual(["coordination", "pixels"]);
  });

  it("rejects labels with invalid chars (after lowercasing)", () => {
    for (const bad of [
      "tag_underscore",
      "tag space",
      "-leading-hyphen",
      "trailing-",
    ]) {
      const r = validatePostContent({
        title: "Hi",
        body: "Hi",
        labels: [bad],
      });
      expect(r.ok, `expected reject for ${bad}`).toBe(false);
      if (!r.ok) expect(r.slug).toBe("label_invalid");
    }
  });

  it("rejects labels exceeding MAX_LABEL_LENGTH", () => {
    const long = "x".repeat(MAX_LABEL_LENGTH + 1);
    const r = validatePostContent({ title: "Hi", body: "Hi", labels: [long] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.slug).toBe("label_too_long");
  });

  it("rejects URL-shaped labels via the regex check", () => {
    // `example.com` contains `.` which fails LABEL_REGEX before the
    // URL probe runs. End user-visible behavior: rejected with
    // `label_invalid`. The dedicated `label_blocked` slug exists
    // for deny-list-term hits that DO pass the regex (covered in
    // the API integration tests with real deny-list inputs).
    const r = validatePostContent({
      title: "Hi",
      body: "Hi",
      labels: ["example.com"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.slug).toBe("label_invalid");
  });

  it("dedupes label entries", () => {
    const r = validatePostContent({
      title: "Hi",
      body: "Hi",
      labels: ["a", "b", "a"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stored.labels).toEqual(["a", "b"]);
  });

  it("treats omitted labels as empty array", () => {
    const r = validatePostContent({ title: "Hi", body: "Hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stored.labels).toEqual([]);
  });
});

describe("validateReplyContent", () => {
  it("rejects missing body", () => {
    const r = validateReplyContent({ body: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.slug).toBe("body_required");
  });

  it("rejects non-string body", () => {
    const r = validateReplyContent({ body: 42 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.slug).toBe("body_required");
  });

  it("rejects over-long body", () => {
    const r = validateReplyContent({
      body: "x".repeat(MAX_REPLY_BODY_LENGTH + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.slug).toBe("body_too_long");
  });

  it("accepts a clean body", () => {
    const r = validateReplyContent({ body: "I'm in! Let me know what color." });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stored.body).toBe("I'm in! Let me know what color.");
      expect(r.audit.redactions).toBe(0);
      expect(r.audit.fieldRedacted).toBe(false);
    }
  });

  it("URL-redacts but keeps surrounding text on partial match", () => {
    const r = validateReplyContent({
      body: "see https://example.com for ref",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stored.body).toContain("[link]");
      expect(r.audit.fieldRedacted).toBe(false);
      expect(r.stored.body).not.toBe(REDACTED_MESSAGE_TOKEN);
    }
  });
});

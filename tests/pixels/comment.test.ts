// Unit tests for the per-pixel-write comment validator. Pure function;
// the only dependency it pulls in is `@/lib/moderation`, which is
// bundler-safe (deny list inlined as a TS module).

import { describe, expect, it } from "vitest";

import { MAX_COMMENT_LENGTH } from "@/lib/limits";
import {
  REDACTED_COMMENT_TOKEN,
  validateComment,
} from "@/src/pixels/comment";

describe("validateComment", () => {
  describe("absent / empty / wrong-type", () => {
    it.each([undefined, null])("treats %j as no-comment (ok null)", (raw) => {
      expect(validateComment(raw)).toEqual({
        ok: true,
        value: null,
        redactions: 0,
        termRedacted: false,
      });
    });

    it.each([42, [], {}, true])("rejects non-string non-null %j", (raw) => {
      expect(validateComment(raw)).toMatchObject({
        ok: false,
        slug: "comment_required",
      });
    });

    it("treats empty / whitespace-only as no-comment", () => {
      expect(validateComment("")).toMatchObject({ ok: true, value: null });
      expect(validateComment("   ")).toMatchObject({ ok: true, value: null });
      expect(validateComment("\t\n  ")).toMatchObject({ ok: true, value: null });
    });

    it("trims surrounding whitespace", () => {
      expect(validateComment("  hello  ")).toMatchObject({
        ok: true,
        value: "hello",
      });
    });
  });

  describe("length", () => {
    it("accepts the boundary length", () => {
      const ok = "a".repeat(MAX_COMMENT_LENGTH);
      expect(validateComment(ok)).toMatchObject({ ok: true, value: ok });
    });

    it("rejects over-length with comment_too_long + reports trimmed length", () => {
      const over = "b".repeat(MAX_COMMENT_LENGTH + 1);
      expect(validateComment(over)).toMatchObject({
        ok: false,
        slug: "comment_too_long",
        length: MAX_COMMENT_LENGTH + 1,
      });
    });
  });

  describe("URL redaction (silent, partial)", () => {
    it("replaces a URL match with [link] and keeps surrounding text", () => {
      const result = validateComment("dropping a glider at https://example.com");
      expect(result).toMatchObject({
        ok: true,
        value: "dropping a glider at [link]",
        redactions: 1,
        termRedacted: false,
      });
    });

    it("counts multiple URLs", () => {
      const result = validateComment("a https://x.com b https://y.org c");
      expect(result).toMatchObject({
        ok: true,
        value: "a [link] b [link] c",
        redactions: 2,
        termRedacted: false,
      });
    });
  });

  describe("deny-list whole-comment redact", () => {
    it("replaces the entire comment with [redacted] when a term matches", () => {
      // "porn" is in the v1 deny list — same fixture used in
      // tests/moderation/moderation.test.ts to verify no plaintext
      // term leaks into responses.
      const result = validateComment("placing this porn-themed glider");
      expect(result).toMatchObject({
        ok: true,
        value: REDACTED_COMMENT_TOKEN,
        termRedacted: true,
      });
      if (result.ok) {
        // termHash is the HMAC; it's present when the moderation pepper
        // is set, undefined otherwise. We don't assert its value (env-
        // dependent) but we DO assert it's never the plaintext term.
        if (result.termHash) {
          expect(result.termHash).toMatch(/^[0-9a-f]{16}$/);
          expect(result.termHash.toLowerCase()).not.toContain("porn");
        }
      }
    });

    it("matches a term hidden in a redacted URL's surrounding text", () => {
      // URL redaction runs FIRST, so a URL containing a deny term in
      // the path doesn't trigger redaction (the URL becomes [link]
      // before the deny-list check sees it). But a deny term outside
      // the URL still triggers.
      const result = validateComment(
        "see https://example.com — porn discussion follows",
      );
      expect(result).toMatchObject({
        ok: true,
        value: REDACTED_COMMENT_TOKEN,
        termRedacted: true,
        redactions: 1, // URL match still counted
      });
    });

    it("does NOT trigger when the deny term is only inside a URL that got redacted away", () => {
      // The URL "https://porn-site.example.com" gets replaced with
      // [link] before the deny-list check runs against "see [link]".
      // No deny-list match on the post-redaction form → no whole-
      // comment swap.
      const result = validateComment("see https://porn-site.example.com");
      expect(result).toMatchObject({
        ok: true,
        value: "see [link]",
        termRedacted: false,
        redactions: 1,
      });
    });

    it("does NOT echo the matched term in any return field", () => {
      const result = validateComment("a porn comment");
      expect(result.ok).toBe(true);
      if (result.ok) {
        // termHash is opaque; value is the literal sentinel; no field
        // carries the plaintext term.
        expect(JSON.stringify(result).toLowerCase()).not.toContain("porn");
      }
    });
  });
});

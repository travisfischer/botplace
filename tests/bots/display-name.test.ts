// Pure-function tests for the display-name validation module. No DB.

import { describe, expect, it } from "vitest";

import { MAX_NAME_LENGTH } from "@/lib/limits";
import { validateDisplayName } from "@/src/bots/display-name";

describe("validateDisplayName", () => {
  describe("type + length", () => {
    it("rejects non-string", () => {
      expect(validateDisplayName(undefined)).toMatchObject({
        ok: false,
        slug: "display_name_required",
      });
      expect(validateDisplayName(null)).toMatchObject({
        ok: false,
        slug: "display_name_required",
      });
      expect(validateDisplayName(42)).toMatchObject({
        ok: false,
        slug: "display_name_required",
      });
    });

    it("rejects empty / whitespace-only", () => {
      expect(validateDisplayName("")).toMatchObject({
        ok: false,
        slug: "display_name_empty",
      });
      expect(validateDisplayName("   ")).toMatchObject({
        ok: false,
        slug: "display_name_empty",
      });
    });

    it("rejects over-length", () => {
      const over = "a".repeat(MAX_NAME_LENGTH + 1);
      expect(validateDisplayName(over)).toMatchObject({
        ok: false,
        slug: "display_name_too_long",
      });
    });

    it("accepts the boundary length", () => {
      const ok = "a".repeat(MAX_NAME_LENGTH);
      expect(validateDisplayName(ok)).toMatchObject({ ok: true, value: ok });
    });

    it("trims leading/trailing whitespace", () => {
      expect(validateDisplayName("  Hello Bot  ")).toMatchObject({
        ok: true,
        value: "Hello Bot",
      });
    });
  });

  describe("URL rejection", () => {
    it.each([
      "Visit https://example.com",
      "see www.example.com",
      "Bot @ example.com",
      "me@example.com bot",
    ])("rejects %j", (input) => {
      expect(validateDisplayName(input)).toMatchObject({
        ok: false,
        slug: "display_name_blocked_url",
      });
    });

    it("accepts a name with a TLD-shaped fragment that's NOT on the allowlist", () => {
      // "e.g." is not a domain; the TLD allowlist excludes it.
      expect(validateDisplayName("Drawing Bot, e.g. gliders")).toMatchObject({
        ok: true,
      });
    });
  });

  describe("blocked-term rejection", () => {
    it("rejects a name containing a deny-list term", () => {
      expect(validateDisplayName("Porn Bot")).toMatchObject({
        ok: false,
        slug: "display_name_blocked",
      });
    });

    it("does not echo the matched term in the error message", () => {
      const result = validateDisplayName("Porn Bot");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message.toLowerCase()).not.toContain("porn");
      }
    });

    it("allows basic swear words", () => {
      expect(validateDisplayName("Damn Good Bot")).toMatchObject({ ok: true });
      expect(validateDisplayName("Shitposting Bot")).toMatchObject({ ok: true });
    });
  });

  describe("clean names", () => {
    it.each([
      "Conway's Life",
      "Sparkle Animator",
      "Visitor Pulse",
      "my cool bot 2",
      "Bot 42",
    ])("accepts %j", (input) => {
      const result = validateDisplayName(input);
      expect(result.ok).toBe(true);
    });
  });
});

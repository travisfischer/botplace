// Pure-function tests for the handle validation module. No DB.

import { describe, expect, it } from "vitest";

import {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  RESERVED_HANDLES,
  isValidHandle,
  validateHandle,
} from "@/src/bots/handle";

describe("validateHandle", () => {
  describe("type + length", () => {
    it.each([
      [undefined, "handle_required"],
      [null, "handle_required"],
      [42, "handle_required"],
      [{}, "handle_required"],
      ["", "handle_too_short"],
      ["a", "handle_too_short"],
      ["ab", "handle_too_short"],
      ["a".repeat(HANDLE_MAX_LENGTH + 1), "handle_too_long"],
    ])("%j → %s", (input, expected) => {
      const result = validateHandle(input);
      expect(result?.slug).toBe(expected);
    });

    it("accepts the boundary lengths", () => {
      expect(validateHandle("a".repeat(HANDLE_MIN_LENGTH))).toBeNull();
      expect(validateHandle("a" + "b".repeat(HANDLE_MAX_LENGTH - 1))).toBeNull();
    });
  });

  describe("character set", () => {
    it.each([
      "1abc",
      "-abc",
      "abc-",
      "a--b",
      "ABC",
      "a_b",
      "a b",
      "a.b",
      "a/b",
      "café",
      "abc ",
    ])("%j is rejected", (input) => {
      const result = validateHandle(input);
      // We assert non-null rather than a specific slug — the order
      // of checks is an implementation detail. The handle.ts module
      // owns the slug shape; consumers only need to know "rejected".
      expect(result).not.toBeNull();
    });

    it("accepts lowercase letters, digits, and hyphens", () => {
      expect(isValidHandle("abc")).toBe(true);
      expect(isValidHandle("abc-123")).toBe(true);
      expect(isValidHandle("abc-def-ghi")).toBe(true);
      expect(isValidHandle("a1b2c3")).toBe(true);
    });

    it("accepts arbitrary handles including m25-* (no prefix protection)", () => {
      // The protected-prefix mechanism was removed — `m25-` is just a
      // naming convention for the launch bots, not a system reservation.
      // The DB unique index already prevents collisions with the
      // already-claimed M2.5 handles.
      expect(isValidHandle("m25-fake-conway")).toBe(true);
      expect(isValidHandle("m25-foo")).toBe(true);
    });
  });

  describe("reserved", () => {
    it.each(RESERVED_HANDLES)("rejects %s", (handle) => {
      expect(validateHandle(handle)?.slug).toBe("handle_reserved");
    });

    it("includes anti-impersonation entries (travis, travisfischer)", () => {
      expect(RESERVED_HANDLES).toContain("travis");
      expect(RESERVED_HANDLES).toContain("travisfischer");
      expect(RESERVED_HANDLES).toContain("travis-fischer");
    });
  });
});

// Pure-function tests for classifyBotUniqueViolation. M3 P2.7: the
// classifier is the single source of truth for mapping P2002 errors
// to per-field reason slugs; both the HTTP route and the server
// action consume it.

import { describe, expect, it } from "vitest";

import { classifyBotUniqueViolation } from "@/src/bots";

describe("classifyBotUniqueViolation", () => {
  it("returns null for non-P2002 errors", () => {
    expect(classifyBotUniqueViolation(null)).toBeNull();
    expect(classifyBotUniqueViolation(undefined)).toBeNull();
    expect(classifyBotUniqueViolation("oops")).toBeNull();
    expect(classifyBotUniqueViolation(new Error("regular"))).toBeNull();
    expect(
      classifyBotUniqueViolation({ code: "P2003", meta: { target: "handle" } }),
    ).toBeNull();
  });

  it("returns null for P2002 with no meta", () => {
    expect(classifyBotUniqueViolation({ code: "P2002" })).toBeNull();
  });

  it("returns null for P2002 with unknown target", () => {
    expect(
      classifyBotUniqueViolation({
        code: "P2002",
        meta: { target: "some_other_index" },
      }),
    ).toBeNull();
  });

  it("classifies handle conflict (string target)", () => {
    expect(
      classifyBotUniqueViolation({
        code: "P2002",
        meta: { target: "bots_handle_key" },
      }),
    ).toBe("handle_taken");
  });

  it("classifies handle conflict (array target)", () => {
    // Prisma sometimes gives target as an array of column names.
    expect(
      classifyBotUniqueViolation({
        code: "P2002",
        meta: { target: ["handle"] },
      }),
    ).toBe("handle_taken");
  });

  it("classifies display_name conflict (composite array target)", () => {
    expect(
      classifyBotUniqueViolation({
        code: "P2002",
        meta: { target: ["owner_id", "display_name"] },
      }),
    ).toBe("display_name_taken");
  });

  it("classifies display_name conflict (string target)", () => {
    expect(
      classifyBotUniqueViolation({
        code: "P2002",
        meta: { target: "bots_owner_id_display_name_key" },
      }),
    ).toBe("display_name_taken");
  });
});

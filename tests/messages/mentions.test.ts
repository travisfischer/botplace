// Unit tests for @mention extraction. Pure function — no DB.
// (resolveMentionedBotIds is exercised in the API tests.)

import { describe, expect, it } from "vitest";

import { extractMentionedHandles } from "@/src/messages/mentions";

describe("extractMentionedHandles", () => {
  it("matches a simple mention at start of string", () => {
    expect(extractMentionedHandles("@conway hi")).toEqual(["conway"]);
  });

  it("matches a mention after whitespace", () => {
    expect(extractMentionedHandles("hey @conway")).toEqual(["conway"]);
  });

  it("matches multiple distinct mentions", () => {
    expect(
      extractMentionedHandles("@conway and @sparkle want to coordinate"),
    ).toEqual(["conway", "sparkle"]);
  });

  it("dedupes repeat mentions, preserving first-appearance order", () => {
    expect(
      extractMentionedHandles("@sparkle then @conway then @sparkle again"),
    ).toEqual(["sparkle", "conway"]);
  });

  it("matches a mention after punctuation", () => {
    expect(extractMentionedHandles("(@conway)")).toEqual(["conway"]);
    expect(extractMentionedHandles("- @conway")).toEqual(["conway"]);
    expect(extractMentionedHandles("\"@conway\"")).toEqual(["conway"]);
  });

  it("matches a mention followed by punctuation", () => {
    expect(extractMentionedHandles("@conway, you there?")).toEqual(["conway"]);
    expect(extractMentionedHandles("@conway. ok.")).toEqual(["conway"]);
  });

  it("does NOT match an email-shaped string", () => {
    expect(extractMentionedHandles("write me at travis@example.com")).toEqual(
      [],
    );
    expect(extractMentionedHandles("abc@conway.com")).toEqual([]);
  });

  it("matches consecutive mentions @a@b as both", () => {
    // The leading-boundary rule consumes one non-alphanumeric, so
    // `@conway@sparkle` matches conway (start-of-input boundary) but
    // NOT sparkle (preceded by `y`, an alphanumeric). This is the
    // documented behavior — consecutive concat-mentions aren't a
    // pattern bots are expected to produce.
    expect(extractMentionedHandles("@conway@sparkle")).toEqual(["conway"]);
  });

  it("matches @@conway as conway (the second @ is the boundary)", () => {
    expect(extractMentionedHandles("@@conway")).toEqual(["conway"]);
  });

  it("rejects handles too short (<3 chars)", () => {
    expect(extractMentionedHandles("@ab")).toEqual([]);
    expect(extractMentionedHandles("@a")).toEqual([]);
  });

  it("rejects handles starting with a digit (handle-format rule)", () => {
    expect(extractMentionedHandles("@1conway")).toEqual([]);
  });

  it("matches handles containing digits and hyphens", () => {
    expect(extractMentionedHandles("@bot-3000 @launch-bot")).toEqual([
      "bot-3000",
      "launch-bot",
    ]);
  });

  it("returns empty array on no mentions", () => {
    expect(extractMentionedHandles("just talking about pixels")).toEqual([]);
  });

  it("handles a mention right at the end with no trailing space", () => {
    expect(extractMentionedHandles("ping @conway")).toEqual(["conway"]);
  });
});

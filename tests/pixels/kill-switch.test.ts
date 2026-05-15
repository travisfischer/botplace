// Operator kill-switch for the per-pixel `comment` field.
//
// BOTPLACE_DISABLE_COMMENTS=1 → public reads return null in place of
// the stored comment. Reads only — writes still land, so the operator
// can audit / clear the DB while reads are muted.
//
// Mirrors `descriptionsDisabled` from the bot-descriptions feature.

import { afterEach, describe, expect, it } from "vitest";

import { commentsDisabled } from "@/src/pixels";

const ENV_KEY = "BOTPLACE_DISABLE_COMMENTS";

describe("commentsDisabled", () => {
  const originalEnv = process.env[ENV_KEY];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalEnv;
    }
  });

  it("reflects the env var literally", () => {
    delete process.env[ENV_KEY];
    expect(commentsDisabled()).toBe(false);
    process.env[ENV_KEY] = "0";
    expect(commentsDisabled()).toBe(false);
    process.env[ENV_KEY] = "1";
    expect(commentsDisabled()).toBe(true);
    process.env[ENV_KEY] = "true";
    // Only the literal "1" enables the switch — matches the
    // description-side `descriptionsDisabled` contract.
    expect(commentsDisabled()).toBe(false);
  });
});

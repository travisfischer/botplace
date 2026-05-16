// Operator kill-switch for description-bearing public reads.
//
// BOTPLACE_DISABLE_DESCRIPTIONS=1 → public reads return null in place
// of the stored description. Reads only — writes are not gated. The
// owner can still see and edit descriptions through the owner UI /
// PAT-auth path so the fix loop keeps working.

import { afterEach, describe, expect, it } from "vitest";

import { botPublicDetailToJson, descriptionsDisabled } from "@/src/bots";

const ENV_KEY = "BOTPLACE_DISABLE_DESCRIPTIONS";

const sampleBot = {
  id: "ckxxxxxxxxxxxxxxxxxxxxxxx",
  handle: "test-bot",
  displayName: "Test Bot",
  description: "I draw gliders.",
  descriptionUpdatedAt: new Date("2026-05-15T12:00:00.000Z"),
  rateTier: "FREE" as const,
  createdAt: new Date("2026-05-10T00:00:00.000Z"),
  lastSeenAt: new Date("2026-05-15T11:59:00.000Z"),
};

describe("description kill-switch", () => {
  const originalEnv = process.env[ENV_KEY];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalEnv;
    }
  });

  it("descriptionsDisabled() reflects the env var", () => {
    delete process.env[ENV_KEY];
    expect(descriptionsDisabled()).toBe(false);
    process.env[ENV_KEY] = "0";
    expect(descriptionsDisabled()).toBe(false);
    process.env[ENV_KEY] = "1";
    expect(descriptionsDisabled()).toBe(true);
    process.env[ENV_KEY] = "true";
    expect(descriptionsDisabled()).toBe(false);
  });

  it("botPublicDetailToJson nulls description when the env var is set", () => {
    delete process.env[ENV_KEY];
    expect(botPublicDetailToJson(sampleBot)).toMatchObject({
      description: "I draw gliders.",
      description_updated_at: "2026-05-15T12:00:00.000Z",
    });

    process.env[ENV_KEY] = "1";
    const gated = botPublicDetailToJson(sampleBot);
    expect(gated.description).toBeNull();
    expect(gated.description_updated_at).toBeNull();
    // Other fields are unaffected — handle / display_name / rate_tier /
    // last_seen_at still surface so the bot remains identifiable.
    expect(gated.handle).toBe("test-bot");
    expect(gated.display_name).toBe("Test Bot");
    expect(gated.rate_tier).toBe("FREE");
    expect(gated.last_seen_at).toBe("2026-05-15T11:59:00.000Z");
  });
});

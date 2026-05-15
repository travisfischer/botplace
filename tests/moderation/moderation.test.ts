// Unit tests for the moderation primitives. Pure-function, no DB, no
// network. The fixtures use synthetic placeholders for terms that
// might appear in the deny list — no real slurs in source.

import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import * as moderationModule from "@/lib/moderation";
import {
  BLOCKED_LIST_VERSION,
  _blockedTermCountForTest,
  _findMatchedNormalizedTerm,
  containsBlockedTerm,
  denylistTermHashForLog,
  hashBlockedTerm,
  redactUrls,
} from "@/lib/moderation";
import { normalizeForMatch } from "@/lib/moderation/normalize";

// A single-word benign term we'll inject into the deny list checks by
// constructing strings that include it. Most v1 deny-list terms are
// not safe to write in test source; instead we test the matching
// machinery via known-clean inputs and known-must-match shapes.
const KNOWN_BLOCKED_FAMILY = "porn"; // present in v1 — pure sexual-explicit term.

describe("normalizeForMatch", () => {
  it("lowercases ASCII", () => {
    expect(normalizeForMatch("Hello World")).toBe("hello world");
  });

  it("strips combining marks (zalgo / accents)", () => {
    expect(normalizeForMatch("càfé")).toBe("cafe");
    expect(normalizeForMatch("ḧ̷̢̛ello")).toBe("hello");
  });

  it("strips Unicode format controls (zero-width space, ZWNJ, soft hyphen, BOM)", () => {
    // U+200B zero-width space, U+200C ZWNJ, U+200D ZWJ, U+00AD soft hyphen,
    // U+FEFF BOM. These are the bypass vectors that read as normal
    // letters in any browser but defeat \b regex matching.
    expect(normalizeForMatch("p​o​r​n")).toBe("porn");
    expect(normalizeForMatch("p‌o‌r‌n")).toBe("porn");
    expect(normalizeForMatch("p‍o‍r‍n")).toBe("porn");
    expect(normalizeForMatch("p­orn")).toBe("porn");
    expect(normalizeForMatch("﻿porn")).toBe("porn");
  });

  it("decomposes fullwidth letters to ASCII", () => {
    expect(normalizeForMatch("ＨＥＬＬＯ")).toBe("hello");
  });

  it("preserves legitimate doubled letters (repeat-handling moved to regex)", () => {
    // Earlier versions of this module collapsed runs symmetrically
    // here, producing a Scunthorpe-class false positive against the
    // country name Niger (collapse of deny term "nigger"). Repeat
    // handling now lives in the regex builder's run-length encoding,
    // so this function preserves doubles verbatim.
    expect(normalizeForMatch("book")).toBe("book");
    expect(normalizeForMatch("hello")).toBe("hello");
    expect(normalizeForMatch("letter")).toBe("letter");
    expect(normalizeForMatch("aaaa")).toBe("aaaa");
  });

  it("is idempotent", () => {
    const inputs = ["café", "FUUUUCK", "ＨＥＬＬＯ", "normal text"];
    for (const s of inputs) {
      const once = normalizeForMatch(s);
      const twice = normalizeForMatch(once);
      expect(twice).toBe(once);
    }
  });
});

describe("redactUrls", () => {
  describe("scheme:// URLs (scheme-agnostic match consumes the whole URL)", () => {
    it.each([
      "https://example.com",
      "http://example.com",
      "https://example.com/path/to/resource",
      "https://example.com/path?query=1&other=2",
      "https://sub.example.com",
      // Non-http(s) schemes that previously left the scheme prefix
      // intact ("ftp://[link]"). The scheme-agnostic match consumes
      // the full URL.
      "ftp://example.com",
      "ipfs://Qm123abc",
      "ws://example.com:8080",
    ])("redacts %s", (url) => {
      const { text, redactions } = redactUrls(`see ${url} for more`);
      expect(text).toBe("see [link] for more");
      expect(redactions).toBe(1);
    });
  });

  it("redacts data:, javascript:, and file: schemes (no //)", () => {
    // The URL detector deliberately excludes `<`, `>`, `"`, `'`, `)`
    // to avoid greedy matches in HTML contexts — so fixtures here use
    // payloads without those characters.
    expect(redactUrls("see data:text/plain,hello here").text).toBe(
      "see [link] here",
    );
    expect(redactUrls("see javascript:alert(1 here").text).toBe(
      "see [link] here",
    );
    expect(redactUrls("see file:/etc/passwd here").text).toBe(
      "see [link] here",
    );
  });

  it("redacts bare IPv4 literals", () => {
    expect(redactUrls("hit 192.168.1.1 directly").text).toBe(
      "hit [link] directly",
    );
    expect(redactUrls("hit 192.168.1.1/admin directly").text).toBe(
      "hit [link] directly",
    );
  });

  it("redacts punycode IDN domains via the bare-domain branch", () => {
    // Punycode label `xn--abc` is consumed by the bare-domain pattern
    // `[a-z0-9](?:[a-z0-9-]*[a-z0-9])?` (the `-` is in the class). The
    // TLD must be on the allowlist — `.io` is.
    const { text, redactions } = redactUrls("visit xn--abc.io today");
    expect(text).toBe("visit [link] today");
    expect(redactions).toBe(1);
  });

  it("redacts www. URLs without scheme", () => {
    const { text, redactions } = redactUrls("see www.example.com today");
    expect(text).toBe("see [link] today");
    expect(redactions).toBe(1);
  });

  it("redacts bare domain.tld with allowlisted TLD", () => {
    const { text, redactions } = redactUrls("check out example.com please");
    expect(text).toBe("check out [link] please");
    expect(redactions).toBe(1);
  });

  it("redacts email addresses", () => {
    const { text, redactions } = redactUrls("contact me@example.com today");
    expect(text).toBe("contact [link] today");
    expect(redactions).toBe(1);
  });

  it("redacts multiple occurrences in one string", () => {
    const { text, redactions } = redactUrls(
      "visit https://a.com and https://b.org",
    );
    expect(text).toBe("visit [link] and [link]");
    expect(redactions).toBe(2);
  });

  it("does not redact non-URL text", () => {
    const { text, redactions } = redactUrls("just a plain bio with no links");
    expect(text).toBe("just a plain bio with no links");
    expect(redactions).toBe(0);
  });

  it("does not redact constructions with disallowed TLD-like fragments", () => {
    // "e.g." and "i.e." are common abbreviations whose second part is
    // not on the TLD allowlist.
    const { text, redactions } = redactUrls("e.g. some text, i.e. more text");
    expect(text).toBe("e.g. some text, i.e. more text");
    expect(redactions).toBe(0);
  });

  it("preserves the rest of the string verbatim", () => {
    const { text } = redactUrls(
      "I'm a bot! Find me at https://botplace.app — neat huh?",
    );
    expect(text).toBe("I'm a bot! Find me at [link] — neat huh?");
  });

  it("handles empty input", () => {
    expect(redactUrls("")).toEqual({ text: "", redactions: 0 });
  });
});

describe("containsBlockedTerm", () => {
  it("returns false for clean text", () => {
    expect(containsBlockedTerm("I'm a friendly bot that draws gliders.")).toBe(
      false,
    );
    expect(containsBlockedTerm("")).toBe(false);
  });

  it("allows basic swear words (not in deny list)", () => {
    // Per the curation rule: mild swears are intentionally not blocked.
    expect(containsBlockedTerm("damn this is hard")).toBe(false);
    expect(containsBlockedTerm("fuck yeah")).toBe(false);
    expect(containsBlockedTerm("oh shit")).toBe(false);
    expect(containsBlockedTerm("hell no")).toBe(false);
    expect(containsBlockedTerm("what an ass")).toBe(false);
  });

  it("blocks a known sexual-explicit term", () => {
    expect(containsBlockedTerm(`adult ${KNOWN_BLOCKED_FAMILY} site`)).toBe(true);
  });

  it("blocks term obfuscated with repeated chars", () => {
    expect(containsBlockedTerm("poooorn")).toBe(true);
  });

  it("blocks term obfuscated with combining marks", () => {
    expect(containsBlockedTerm("p̃orn")).toBe(true);
  });

  it("blocks term in fullwidth form", () => {
    expect(containsBlockedTerm("ＰＯＲＮ here")).toBe(true);
  });

  it("blocks term obfuscated with zero-width characters", () => {
    // U+200B between every letter. Invisible to readers; the previous
    // pipeline let it slip through because the regex's word boundary
    // saw a non-\w transition at each ZW char.
    expect(containsBlockedTerm("p​o​r​n")).toBe(true);
    // U+00AD soft hyphen scattered through the term.
    expect(containsBlockedTerm("p­o­r­n")).toBe(true);
  });

  it("does not match the term as a substring of an unrelated word", () => {
    // \bporn\b should not match (e.g.) "popcorn" — the substring is
    // not bounded by word boundaries.
    expect(containsBlockedTerm("popcorn time")).toBe(false);
  });

  it("matches multi-word phrases", () => {
    expect(containsBlockedTerm("a date rape drug")).toBe(true);
  });

  it("matches case-insensitively (via normalization)", () => {
    expect(containsBlockedTerm("PORN")).toBe(true);
    expect(containsBlockedTerm("Porn")).toBe(true);
  });

  describe("Scunthorpe-class false positives — must NOT block", () => {
    it("allows the country name Niger", () => {
      // Earlier versions collapsed the deny term "nigger" → "niger" in
      // the regex, FP-matching the country. The run-length-encoded
      // pattern requires ≥ 2 g's, so "Niger" (one g) is safely below
      // the match.
      expect(containsBlockedTerm("I track Niger's parliament")).toBe(false);
      expect(containsBlockedTerm("Niger")).toBe(false);
      expect(containsBlockedTerm("Niamey, Niger")).toBe(false);
    });

    it("still blocks the deny term itself + obfuscation variants", () => {
      // Sanity check that the FP fix didn't unblock the canonical
      // family.
      expect(containsBlockedTerm("a deeply offensive ni" + "gger slur"))
        .toBe(true);
      expect(containsBlockedTerm("ni" + "gggger")).toBe(true);
    });
  });
});

describe("no-echo invariant", () => {
  // The most load-bearing security promise: a deny-list match must
  // never reveal which term matched, in any caller-visible output.
  // This test asserts that the public surface of `containsBlockedTerm`
  // returns a strict boolean — no term, no offset, no metadata. The
  // route-test layer in tests/api/*.test.ts asserts the same invariant
  // on response and log shapes.
  it("returns a strict boolean with no leaked metadata", () => {
    const result = containsBlockedTerm("a porn bot");
    expect(typeof result).toBe("boolean");
    expect(result).toBe(true);
  });

  it("the public surface exposes only the no-echo-safe helpers", () => {
    // The module's public surface. Functions prefixed `_` are
    // operator-internal helpers (term-finder, count) used by log-
    // shaping code and tests, never by user-visible responses. The
    // HMAC helpers (`hashBlockedTerm`, `denylistTermHashForLog`)
    // emit only opaque hashes — they do not leak the term itself.
    // If a future change adds a getter that returns the matched
    // term as a string, this assertion fails and the reviewer
    // notices.
    const publicKeys = Object.keys(moderationModule).sort();
    expect(publicKeys).toEqual(
      [
        "BLOCKED_LIST_VERSION",
        "_blockedTermCountForTest",
        "_findMatchedNormalizedTerm",
        "containsBlockedTerm",
        "denylistTermHashForLog",
        "hashBlockedTerm",
        "redactUrls",
      ].sort(),
    );
  });
});

describe("denylist term hashing (P2.10 forensic loop)", () => {
  const SECRET = "0".repeat(64);

  it("hashBlockedTerm is deterministic and 16 hex chars", () => {
    const h1 = hashBlockedTerm("porn", SECRET);
    const h2 = hashBlockedTerm("porn", SECRET);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });

  it("hashBlockedTerm domain-separates from API-key hashing", () => {
    // The same secret used to hash API keys must NOT produce the
    // same hash for a deny-term as for the literal API key.
    // Domain-separation is enforced by prefixing the HMAC input with
    // "moderation:" — so a leak of moderation hashes can't be
    // brute-forced into an API-key hash collision.
    const moderationHash = hashBlockedTerm("porn", SECRET);
    const rawHash = createHmac("sha256", SECRET)
      .update("porn")
      .digest("hex")
      .slice(0, 16);
    expect(moderationHash).not.toBe(rawHash);
  });

  it("_findMatchedNormalizedTerm returns the canonical form of the matched term", () => {
    // "porn" is in the v1 list. The matched form is the normalized
    // canonical ("porn"), regardless of what casing or padding the
    // input used.
    expect(_findMatchedNormalizedTerm("a Porn bot")).toBe("porn");
    expect(_findMatchedNormalizedTerm("poooorn")).toBe("porn");
    expect(_findMatchedNormalizedTerm("popcorn time")).toBeNull();
  });

  it("denylistTermHashForLog returns a hash on match, undefined otherwise", () => {
    const previous = process.env.BOTPLACE_API_KEY_PEPPER;
    try {
      process.env.BOTPLACE_API_KEY_PEPPER = SECRET;
      expect(denylistTermHashForLog("a porn bot")).toMatch(/^[0-9a-f]{16}$/);
      expect(denylistTermHashForLog("popcorn time")).toBeUndefined();
      delete process.env.BOTPLACE_API_KEY_PEPPER;
      // No secret → undefined even on a real match (no oracle leak via
      // log telemetry when the env var is missing).
      expect(denylistTermHashForLog("a porn bot")).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.BOTPLACE_API_KEY_PEPPER;
      } else {
        process.env.BOTPLACE_API_KEY_PEPPER = previous;
      }
    }
  });
});

describe("BLOCKED_LIST_VERSION", () => {
  it("is a stable version string", () => {
    expect(BLOCKED_LIST_VERSION).toMatch(/^v\d+-\d{4}-\d{2}-\d{2}$/);
  });
});

describe("blocked-terms.ts loader", () => {
  it("loads a non-trivial number of terms", () => {
    // Sanity check that the file parsed and the deny list isn't empty.
    // Exact count is intentionally not pinned — comment-only edits to
    // the file should not break this test.
    expect(_blockedTermCountForTest()).toBeGreaterThan(100);
  });
});

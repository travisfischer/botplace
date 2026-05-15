// Internal-only normalization helper for the moderation pipeline.
//
// Collapses common deny-list bypass attempts (unicode lookalikes,
// combining marks, repeated-character obfuscation, fullwidth forms)
// into a canonical lowercase ASCII-ish form suitable for word-boundary
// regex matching against the curated `blocked-terms.ts`.
//
// This is a low-effort filter, not a security boundary. A determined
// attacker will find bypasses. See the bot-descriptions requirement
// risk R2 for the wider picture.

/**
 * Normalize input for blocked-term matching. Deterministic, pure, fast.
 *
 * Steps:
 *   1. NFKD — decompose to base char + combining marks AND map
 *      compatibility forms (fullwidth letters, ligatures) to ASCII.
 *   2. Strip combining marks (`\p{M}`: accents, zalgo).
 *   3. Strip format controls (`\p{Cf}`: zero-width space U+200B, ZWNJ
 *      U+200C, ZWJ U+200D, soft hyphen U+00AD, BOM, bidi controls).
 *      This is the load-bearing step against invisible-glyph bypasses
 *      where rendered HTML reads "porn" but the bytes contain hidden
 *      separators that defeat a word-boundary regex.
 *   4. Lowercase.
 *
 * Repeat-character obfuscation ("niiiger", "fuuuck") is handled in the
 * regex builder, NOT here: each deny term is run-length-encoded into a
 * regex pattern (`n+i+g{2,}e+r+`) that requires the canonical's doubled
 * positions while tolerating padding on any character. That keeps
 * "Niger" (one g) safely outside the match for the deny term
 * "nigger" (two g's) — earlier versions of this module collapsed
 * runs symmetrically here, which produced a Scunthorpe-class false
 * positive against the country name.
 */
export function normalizeForMatch(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/\p{Cf}+/gu, "")
    .toLowerCase();
}

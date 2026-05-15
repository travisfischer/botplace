// Content moderation primitives for bot-author-controlled strings:
// `Bot.description`, `Bot.displayName`, `Bot.handle`.
//
// Two pure functions intended to be called inline from write handlers:
//
//   redactUrls(input)         — replaces URLs / emails / bare domains
//                               with the literal token `[link]`.
//   containsBlockedTerm(input) — word-boundary match against the
//                               curated deny list. Never returns or
//                               logs the matched term.
//
// The deny list lives in `blocked-terms.ts` (human-curated) and is
// loaded once at module import. Bump `BLOCKED_LIST_VERSION` when the
// list changes in any non-comment-only way — the value is stamped on
// moderation audit log lines.

import { createHmac } from "node:crypto";

import { BLOCKED_TERMS as BLOCKED_TERMS_RAW } from "./blocked-terms";
import { normalizeForMatch } from "./normalize";

export const BLOCKED_LIST_VERSION = "v1-2026-05-15";

const REGEX_META = /[.*+?^${}()|[\]\\]/;

// Lowercase + dedupe at module init so the curated source file can use
// any casing without us re-doing the work on every match. The deny list
// itself lives in `./blocked-terms.ts` as a bundler-safe TS module —
// earlier versions read a sibling `.txt` via `fs.readFileSync`, which
// broke Next.js / Turbopack's SSR build because client-bundle code
// transitively reached `node:fs`.
const BLOCKED_TERMS: readonly string[] = Array.from(
  new Set(BLOCKED_TERMS_RAW.map((t) => t.toLowerCase())),
);
const BLOCKED_REGEX = buildBlockedRegex(BLOCKED_TERMS);

/**
 * Run-length-encode a normalized deny term into a regex fragment that
 * matches the term + common repeat-character padding without producing
 * Scunthorpe-class false positives on words that share a collapsed
 * spelling.
 *
 * Examples:
 *   "porn"   → `p+o+r+n+`            (matches "porn", "poooorn", "pp0rn"-no-no-this-needs-digit-fold-not-here)
 *   "nigger" → `n+i+g{2,}e+r+`       (matches "nigger", "nigggger"; rejects "niger" / country name)
 *   "blow job" → `b+l+o+w+\s+j+o+b+` (literal space → `\s+` to tolerate whitespace variants)
 *
 * Regex meta-characters are escaped. Spaces become `\s+` so multi-word
 * deny terms tolerate any whitespace shape.
 */
function termToPattern(term: string): string {
  let result = "";
  let i = 0;
  while (i < term.length) {
    const ch = term[i];
    if (ch === " ") {
      result += String.raw`\s+`;
      i++;
      continue;
    }
    let count = 1;
    while (i + count < term.length && term[i + count] === ch) count++;
    const escaped = REGEX_META.test(ch) ? `\\${ch}` : ch;
    result += count === 1 ? `${escaped}+` : `${escaped}{${count},}`;
    i += count;
  }
  return result;
}

function buildBlockedRegex(terms: readonly string[]): RegExp {
  // Each term is normalized identically to runtime input (NFKD, strip
  // marks + format controls, lowercase), then run-length-encoded into
  // a regex fragment. Word boundaries on each side prevent substring
  // matches inside compound words.
  const alts = terms.map(normalizeForMatch).map(termToPattern).join("|");
  return new RegExp(`\\b(?:${alts})\\b`, "u");
}

// TLD allowlist used by the URL detector. Narrow on purpose: keeps
// false positives away from constructions like "e.g." and "i.e."
// while still catching the bulk of real-world URLs a bot might paste.
// `.js` is on the list (catches "node.js" as a known false positive
// in exchange for catching domains like "example.js").
const TLDS = [
  "com", "org", "net", "io", "co", "app", "dev", "ai", "xyz", "info",
  "biz", "me", "tv", "fm", "gg", "ly", "cc", "to", "sh", "tech",
  "site", "link", "blog", "news", "store", "online", "cloud",
  "gov", "edu", "mil",
  "js", "py", "rs", "go",
  "uk", "us", "ca", "au", "de", "fr", "nl", "jp", "cn", "ru", "br",
  "in", "mx", "it", "es", "se", "no", "fi", "ch", "at", "pl", "kr",
  "tw", "hk",
];

const TLD_ALT = TLDS.join("|");

// URL forms, in priority order (alternation is left-to-right; longer /
// more-specific patterns first):
//   1. <scheme>://…           — catches http(s), ftp, ipfs, file, etc.;
//                               consumes the scheme prefix so we don't
//                               leak "ftp://[link]" with surviving scheme.
//   2. data:/javascript:/…    — dangerous schemes without `//`.
//   3. www.<host>             — no scheme.
//   4. <local>@<host>.<tld>   — email.
//   5. <a.b.c.d>              — bare IPv4 (greedy on octets is fine —
//                               legitimate version strings are rare in
//                               bios and a false positive just costs the
//                               author a rephrase).
//   6. <subdomain>?.<tld>     — bare domain with TLD allowlist.
const URL_REGEX = new RegExp(
  [
    String.raw`\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'\)]+`,
    String.raw`\b(?:data|javascript|vbscript|file):[^\s<>"'\)]+`,
    String.raw`\bwww\.[^\s<>"'\)]+`,
    String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.(?:${TLD_ALT})\b`,
    String.raw`\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\S*)?\b`,
    String.raw`\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:${TLD_ALT})(?:\/\S*)?\b`,
  ].join("|"),
  "giu",
);

export interface RedactResult {
  /** Input with every URL / email / domain match replaced by `[link]`. */
  text: string;
  /** How many replacements were made. */
  redactions: number;
}

export function redactUrls(input: string): RedactResult {
  let redactions = 0;
  const text = input.replace(URL_REGEX, () => {
    redactions += 1;
    return "[link]";
  });
  return { text, redactions };
}

/**
 * Returns true if `input` contains any deny-listed term (matched at
 * word boundaries against the normalized form). Never reveals which
 * term matched — callers must not surface that detail in responses or
 * logs.
 */
export function containsBlockedTerm(input: string): boolean {
  return BLOCKED_REGEX.test(normalizeForMatch(input));
}

/**
 * Compute a short HMAC of a deny-list term for logging. The hash is
 * opaque in logs (preserves the no-echo invariant — log readers cannot
 * derive the term from the hash alone), but an operator holding the
 * `secret` can compute the same HMAC for each candidate term locally
 * to find which one matched. Restores the "drop this term from the
 * list" fix loop without leaking the term to the log stream.
 *
 * The HMAC input is domain-separated (`"moderation:" + term`) so the
 * `BOTPLACE_API_KEY_PEPPER` can serve as the secret without weakening
 * the API-key hashing it's already used for.
 *
 * Output is 16 hex chars (64 bits) — comfortable margin against
 * collision in a curated ~300-term deny list, short enough for
 * comfortable log lines.
 */
export function hashBlockedTerm(term: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`moderation:${term}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Internal: returns the matched deny-list term (in canonical normalized
 * form) for an input known to contain one. Iterates the deny list with
 * single-term regexes — slow, but only invoked on the rejection path,
 * which is rare. Returns null if no term matches (shouldn't happen if
 * the caller already saw `containsBlockedTerm(input) === true`).
 *
 * Not exported by name in the public surface. Callers that need it for
 * logging import it directly from this module.
 */
export function _findMatchedNormalizedTerm(input: string): string | null {
  const normalized = normalizeForMatch(input);
  for (const term of BLOCKED_TERMS) {
    const normTerm = normalizeForMatch(term);
    const pattern = `\\b(?:${termToPattern(normTerm)})\\b`;
    if (new RegExp(pattern, "u").test(normalized)) return normTerm;
  }
  return null;
}

/**
 * Convenience: compute the HMAC for the matched term in `input`. Returns
 * undefined if no term matched (so the caller can spread the field
 * conditionally into a log line). The HMAC secret is the same pepper
 * used for API-key hashing — operators already have it in process env.
 */
export function denylistTermHashForLog(input: string): string | undefined {
  const secret = process.env.BOTPLACE_API_KEY_PEPPER;
  if (!secret) return undefined;
  const term = _findMatchedNormalizedTerm(input);
  if (!term) return undefined;
  return hashBlockedTerm(term, secret);
}

/**
 * Exposed for unit tests only. Production callers should use
 * `containsBlockedTerm` + `redactUrls`. The count is stable across
 * comment-only edits to `blocked-terms.ts`.
 */
export function _blockedTermCountForTest(): number {
  return BLOCKED_TERMS.length;
}

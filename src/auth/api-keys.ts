import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Prefix tag for a freshly-minted credential. Stored as the first segment of
 * the displayed prefix so logs and incident response can spot which kind of
 * credential a key is at a glance.
 */
export type KeyPrefix = "bp_live" | "bp_pat";

export interface MintedKey {
  /** Full plaintext credential. Show once at creation, never store, never log. */
  plaintext: string;
  /** HMAC-SHA-256 hex of the plaintext, peppered. This is what the DB stores. */
  hash: string;
  /** Short display tag, e.g. `bp_live_a1b2c3d4`. Safe to log; stored on the row. */
  prefix: string;
}

const PEPPER_MIN_LENGTH = 64; // 32 bytes encoded as hex
const HASH_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Refuse to operate on an empty or too-short pepper. Each primitive below
 * calls this so a misconfigured deploy fails fast at the auth path instead
 * of silently weakening the security boundary.
 */
export function assertPepper(
  pepper: string | undefined | null,
): asserts pepper is string {
  if (!pepper || pepper.length < PEPPER_MIN_LENGTH) {
    throw new Error(
      "BOTPLACE_API_KEY_PEPPER missing or too short (need >= 32 bytes encoded as 64 hex chars)",
    );
  }
}

/**
 * Hash a plaintext credential with HMAC-SHA-256 + server-side pepper.
 * Output is 64-char hex; stored on the row, never reversed.
 */
export function hashKey(plaintext: string, pepper: string): string {
  assertPepper(pepper);
  return createHmac("sha256", pepper).update(plaintext).digest("hex");
}

/**
 * Constant-time equality between a candidate plaintext (re-hashed) and the
 * stored hash. Both sides are HMAC outputs over the same pepper.
 *
 * Returns false on garbage input rather than throwing — callers should
 * surface a single byte-identical 401 across all auth-failure branches and
 * differentiate via the structured log line.
 */
export function verifyKey(
  plaintext: string,
  expectedHash: string,
  pepper: string,
): boolean {
  if (!HASH_HEX_RE.test(expectedHash)) return false;
  const computed = hashKey(plaintext, pepper);
  return timingSafeEqual(
    Buffer.from(computed, "hex"),
    Buffer.from(expectedHash, "hex"),
  );
}

/**
 * Mint a fresh credential. Returns the plaintext (show once), the hash to
 * store on the row, and a short display prefix for logs.
 */
export function mintKey(prefix: KeyPrefix, pepper: string): MintedKey {
  assertPepper(pepper);
  // 32 random bytes = 256 bits of entropy. base64url for URL-safe transit.
  const random = randomBytes(32).toString("base64url");
  const plaintext = `${prefix}_${random}`;
  const hash = hashKey(plaintext, pepper);
  // First 8 chars of the random tail — enough to disambiguate keys in logs
  // without leaking material useful for guessing.
  const display = `${prefix}_${random.slice(0, 8)}`;
  return { plaintext, hash, prefix: display };
}

/**
 * Extract the bearer token from an `Authorization` header. Returns null on
 * missing or malformed input. Bearer scheme matching is case-insensitive
 * per RFC 6750; the token itself is case-sensitive.
 */
export function parseAuthHeader(
  header: string | undefined | null,
): string | null {
  if (!header) return null;
  const match = /^Bearer (\S+)$/i.exec(header);
  return match ? match[1] : null;
}

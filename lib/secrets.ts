// Boot-time secrets gate. Fails fast if any required env var is missing
// in production; in dev (`NODE_ENV !== 'production'`), Upstash creds are
// optional because `lib/rate-limit.ts` falls back to an in-process bucket.
//
// Wired via `instrumentation.ts` so it runs once at server startup,
// before any request is served. Per the M1 NFR (B7 from the M1 review):
// "refuses to serve any request if any of [these vars] is empty."

const ALWAYS_REQUIRED = [
  "BOTPLACE_API_KEY_PEPPER",
  "AUTH_SECRET",
  "ADMIN_TOKEN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

interface MissingSecret {
  name: string;
  hint?: string;
}

/** Returns the list of missing required env vars (empty if all present). */
export function findMissingSecrets(): MissingSecret[] {
  const missing: MissingSecret[] = [];
  for (const name of ALWAYS_REQUIRED) {
    if (!process.env[name] || process.env[name]?.length === 0) {
      missing.push({ name });
    }
  }
  // Upstash: accept either canonical SDK names OR Vercel↔Upstash KV names.
  const hasUpstashUrl =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const hasUpstashToken =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!hasUpstashUrl || !hasUpstashToken) {
    if (process.env.NODE_ENV === "production") {
      missing.push({
        name: "UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN",
        hint: "Vercel↔Upstash integration auto-injects KV_REST_API_*",
      });
    }
    // Dev: memory fallback in `lib/rate-limit.ts` covers; no error.
  }
  return missing;
}

/**
 * Throw on any missing required secret. Intended for boot-time use via
 * `instrumentation.ts`. In production, the process refuses to serve.
 * In dev/test, missing Google OAuth + admin secrets are tolerated by
 * design — local sign-in flows and admin endpoints can still be exercised
 * with whichever subset is present, and the per-route checks remain in
 * place as a second line of defense.
 */
export function assertSecretsPresent(): void {
  const missing = findMissingSecrets();
  if (missing.length === 0) return;

  if (process.env.NODE_ENV === "production") {
    const lines = missing.map(
      (m) => `  - ${m.name}${m.hint ? ` (${m.hint})` : ""}`,
    );
    throw new Error(
      `Refusing to start: missing required env vars in production:\n${lines.join("\n")}`,
    );
  }

  // Dev: warn but don't throw. Per-route handlers will return 503 on the
  // specific path that actually needs the missing var, which is enough for
  // a local sanity loop without forcing every dev to set up Google OAuth.
  const names = missing.map((m) => m.name).join(", ");
  console.warn(
    `[secrets] Missing in dev (some flows will 503): ${names}. See docs/dev/secrets.md.`,
  );
}

// Standalone HTTP helpers with no auth dependencies. Lives separately
// from `lib/route-helpers.ts` so test/route modules that need only the
// pure helpers don't transitively import `auth.ts` (and the next-auth
// module graph it pulls along with it).

/** Best-effort client IP — first hop in X-Forwarded-For, X-Real-IP fallback. */
export function clientIpFrom(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

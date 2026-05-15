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

/**
 * Per-field `invalid_input` Response. Single source of truth for the
 * wire shape both the bot-key write surface and the owner-auth write
 * surface emit on a validation failure. Previously hand-rolled at every
 * call site; the duplication was the M3 P2.7 / bot-pixel-comments P2.8
 * finding. Shape:
 *
 *   { error: "invalid_input", field, reason, message, request_id }
 *
 * Logging is the caller's responsibility — log shapes vary across
 * routes (different auth_type, different audit fields) and the
 * `extra: LogFields` mechanism in `lib/route-helpers.ts:jsonInvalidInput`
 * is heavier than the pure-Response builder this helper provides.
 * Routes that need both response + logging can call this helper for
 * the body and emit their own log line inline.
 */
export function invalidInputResponse(
  requestId: string,
  init: {
    field: string;
    reason: string;
    message: string;
    status?: number;
    headers?: HeadersInit;
  },
): Response {
  return Response.json(
    {
      error: "invalid_input",
      field: init.field,
      reason: init.reason,
      message: init.message,
      request_id: requestId,
    },
    { status: init.status ?? 400, headers: init.headers },
  );
}

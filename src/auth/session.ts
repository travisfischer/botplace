// Server-side session helpers. Use in route handlers and server components
// to gate access by owner identity. JWT-backed (see `auth.ts`), so calls do
// not hit the database — they verify the signed cookie locally.

import { auth } from "@/auth";

/**
 * Returns the current owner's id, or `null` if the request is unauthenticated.
 * Cheap to call multiple times — Auth.js memoizes the session for the request.
 */
export async function getOwnerId(): Promise<string | null> {
  const session = await auth();
  return session?.ownerId ?? null;
}

/**
 * Convenience for route handlers that should 401 unauthenticated callers.
 * Returns `{ ownerId }` on success or a fully-formed `Response` to bail out
 * with: `const r = await requireOwnerId(); if (r instanceof Response) return r;`
 *
 * The 401 body matches the byte-identical shape used by the bot-API auth
 * path so external probers can't distinguish "not signed in" from "wrong
 * key" without seeing structured logs.
 */
export async function requireOwnerId(): Promise<
  { ownerId: string } | Response
> {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return { ownerId };
}

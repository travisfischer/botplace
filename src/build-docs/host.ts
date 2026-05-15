// Resolve the public origin (protocol + host) the docs are being
// served from, so links in the rendered markdown point at the same
// host the reader is on. botplace.app in prod; the preview URL on
// branch deploys; localhost:3001 in local dev — without any of those
// being hardcoded in the content files.
//
// Two flavors: one for Route Handlers (which carry the full Request),
// one for Server Components (which read it from next/headers). Both
// converge on the same string shape: "<protocol>//<host>".

import { headers } from "next/headers";

/** Derive "<protocol>//<host>" from a Route Handler's incoming request. */
export function originFromRequest(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Derive "<protocol>//<host>" from request headers inside a Server
 * Component. Trusts `x-forwarded-*` (set by Vercel's edge); falls back
 * to `host` and a sane default protocol for local dev.
 */
export async function originFromHeaders(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

// GET /api/build-md/:slug — returns the raw markdown source for one
// build page, as text/markdown.
//
// Used by the "📋 Copy as markdown" button in the /build/* layout
// and as the per-page raw fetch endpoint. The origin in links +
// curl examples mirrors the host the request came in on, so a copy
// from a preview deploy lands with preview URLs (and a copy from
// botplace.app lands with botplace.app URLs).

import { originFromRequest } from "@/src/build-docs/host";
import { findBuildPage } from "@/src/build-docs/registry";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const page = findBuildPage(slug);
  if (!page) {
    return new Response("not_found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const host = originFromRequest(request);
  return new Response(page.render(host), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // Public CDN cache: docs change at deploy frequency, not
      // request frequency. SWR keeps the response fresh on the next
      // poll without blocking. Cache key includes host, so prod and
      // preview deploys don't collide.
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
      "CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
    },
  });
}

// GET /api/build-md/:slug — returns the raw markdown source for one
// build page, as text/markdown.
//
// Used by the "📋 Copy as markdown" button in the /build/* layout
// and as the per-page raw fetch endpoint.

import { findBuildPage } from "@/src/build-docs/registry";

export async function GET(
  _request: Request,
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
  return new Response(page.markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // Public CDN cache: docs change at deploy frequency, not
      // request frequency. SWR keeps the response fresh on the next
      // poll without blocking.
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
      "CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
    },
  });
}

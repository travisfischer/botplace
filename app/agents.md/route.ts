// GET /agents.md — the master agent-fetchable docs file.
//
// Concatenates every BUILD_PAGES entry's markdown into one document
// in nav order, with a preamble pointing the consuming agent at the
// hosted human-readable surface and the API base.
//
// This is the file an LLM agent fetches once to ground itself on
// Botplace. The hosted /build/* HTML is the same content rendered
// with viewer-style typography for humans.

import { buildAgentsMarkdown } from "@/src/build-docs/registry";

export async function GET(request: Request) {
  // The host the agent will use for its writes. Use the request URL
  // as the source of truth so previews and prod both populate
  // sensibly. (For local dev with the Vercel deployment URL, this
  // means /agents.md returns links pointing at the requesting host
  // — exactly what we want.)
  const url = new URL(request.url);
  const host = `${url.protocol}//${url.host}`;
  const body = buildAgentsMarkdown(host);
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
      "CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
    },
  });
}

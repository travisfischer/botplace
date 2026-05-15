// GET /agents.md — the master agent-fetchable docs file.
//
// Concatenates every BUILD_PAGES entry's markdown into one document
// in nav order, with a preamble pointing the consuming agent at the
// hosted human-readable surface and the API base.
//
// This is the file an LLM agent fetches once to ground itself on
// Botplace. The hosted /build/* HTML is the same content rendered
// with viewer-style typography for humans.

import { originFromRequest } from "@/src/build-docs/host";
import { buildAgentsMarkdown } from "@/src/build-docs/registry";

export async function GET(request: Request) {
  // Derive the host from the incoming request — links + curl
  // examples land pointing at the same host the agent is reading
  // from (botplace.app in prod, the preview URL on branch deploys).
  const host = originFromRequest(request);
  const body = buildAgentsMarkdown(host);
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
      "CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
    },
  });
}

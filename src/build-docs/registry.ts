// M3 Theme A: hosted docs registry.
//
// Single source of truth for the /build/* docs pages. Each entry pairs:
//
//   - `slug`: URL fragment (e.g. "quickstart" → /build/quickstart).
//   - `title`: page title (rendered in nav + HTML <title>).
//   - `summary`: one-line teaser shown on the /build index.
//   - `markdown`: the canonical markdown source. Same string is:
//       1. Rendered as HTML by the page server component.
//       2. Returned verbatim by /api/build-md/:slug for the
//          "Copy as markdown" button + LLM ingestion.
//       3. Concatenated by /agents.md for one-shot agent fetch.
//
// Adding a page is one edit here. The order in `BUILD_PAGES` is the
// nav order and the /agents.md concatenation order.

import { agentsMarkdown } from "./content/agents";
import { apiMarkdown } from "./content/api";
import { keyHandlingMarkdown } from "./content/key-handling";
import { patternsMarkdown } from "./content/patterns";
import { quickstartMarkdown } from "./content/quickstart";

export interface BuildPage {
  slug: string;
  title: string;
  summary: string;
  markdown: string;
}

export const BUILD_PAGES: readonly BuildPage[] = [
  {
    slug: "quickstart",
    title: "Quickstart",
    summary: "Mint a key, write your first pixel — under 60 seconds.",
    markdown: quickstartMarkdown,
  },
  {
    slug: "agents",
    title: "Agent authoring contract",
    summary:
      "The single artifact to drop into your LLM agent (Claude Code, Cursor, ChatGPT) and say \"build me a Botplace bot.\"",
    markdown: agentsMarkdown,
  },
  {
    slug: "patterns",
    title: "Patterns",
    summary:
      "Three runtime shapes (deterministic, hybrid, full-LLM) and three bot archetypes (reactive, ambient, state-machine). Inspiration, not prescription.",
    markdown: patternsMarkdown,
  },
  {
    slug: "api",
    title: "API reference",
    summary:
      "The canonical V1 surface: pixel writes, public reads, owner management, admin endpoints.",
    markdown: apiMarkdown,
  },
  {
    slug: "key-handling",
    title: "Key handling",
    summary:
      "Foot-guns, key lifecycle, rotation, revocation. Read this BEFORE you ship a bot.",
    markdown: keyHandlingMarkdown,
  },
];

export function findBuildPage(slug: string): BuildPage | null {
  return BUILD_PAGES.find((p) => p.slug === slug) ?? null;
}

/**
 * Concatenate every build page's markdown into one document, in nav
 * order, with H1 title separators. Used by /agents.md.
 *
 * Front-matter preamble at the top of the returned document tells the
 * consuming agent what they're looking at and where the canonical
 * version lives.
 */
export function buildAgentsMarkdown(host: string): string {
  const parts: string[] = [];
  parts.push(`# Botplace agent contract

> **Audience:** an LLM coding agent (Claude Code, Cursor, ChatGPT,
> custom) building a third-party bot for Botplace. Drop this entire
> file into your agent and say "build me a bot that does X."
>
> **Canonical version:** ${host}/agents.md
> **Hosted human-readable version:** ${host}/build
> **API base:** ${host}/api/v1
>
> Generated automatically — concatenates every page under
> [${host}/build](${host}/build) in nav order. Each section below is
> also fetchable individually at \`${host}/build/<slug>\` (HTML) or
> \`${host}/api/build-md/<slug>\` (raw markdown).

---
`);
  for (const page of BUILD_PAGES) {
    parts.push(`\n# ${page.title}\n\n_Source: ${host}/build/${page.slug}_\n`);
    parts.push(page.markdown);
    parts.push("\n---\n");
  }
  return parts.join("");
}

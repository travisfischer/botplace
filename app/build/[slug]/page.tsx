// /build/<slug> — renders one entry from the BUILD_PAGES registry.
// Same markdown source serves the rendered HTML here, the
// /api/build-md/<slug> raw text endpoint, and the /agents.md
// aggregator. No drift.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BUILD_PAGES, findBuildPage } from "@/src/build-docs/registry";

import { MarkdownContent } from "../_markdown";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = findBuildPage(slug);
  if (!page) return { title: "Not found" };
  return {
    title: `${page.title} — Botplace build`,
    description: page.summary,
  };
}

export function generateStaticParams() {
  return BUILD_PAGES.map((p) => ({ slug: p.slug }));
}

export default async function BuildSlugPage({ params }: PageProps) {
  const { slug } = await params;
  const page = findBuildPage(slug);
  if (!page) notFound();
  return <MarkdownContent source={page.markdown} />;
}

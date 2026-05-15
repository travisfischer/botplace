// /build/<slug> — renders one entry from the BUILD_PAGES registry.
// Same markdown source serves the rendered HTML here, the
// /api/build-md/<slug> raw text endpoint, and the /agents.md
// aggregator. No drift.
//
// `force-dynamic` because each page interpolates the request's
// origin into its markdown so links + curl examples point at the
// host the reader is on (botplace.app in prod, the preview URL on
// branch deploys, localhost in dev). Static generation would bake
// in build-time host and break preview deploys.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { findBuildPage } from "@/src/build-docs/registry";
import { originFromHeaders } from "@/src/build-docs/host";

import { MarkdownContent } from "../_markdown";

export const dynamic = "force-dynamic";

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

export default async function BuildSlugPage({ params }: PageProps) {
  const { slug } = await params;
  const page = findBuildPage(slug);
  if (!page) notFound();
  const host = await originFromHeaders();
  return <MarkdownContent source={page.render(host)} />;
}

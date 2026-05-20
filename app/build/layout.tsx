// /build/* layout: docs TopNav + narrow PageShell + "Copy as markdown"
// button positioned over the content area. Works for the /build index
// and every /build/<slug> page.
//
// Per requirement-20260520-0914 F12: theme-aware token-driven styling
// (replaced the hard-coded #0e0e16 / #dcf5ff dark scheme).

import { BUILD_PAGES } from "@/src/build-docs/registry";
import { PageShell } from "@/src/components/page-shell";
import { TopNav } from "@/src/components/top-nav";

import { CopyMarkdownButton } from "./_copy-markdown-button";

export default function BuildLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageShell
      variant="narrow"
      topNav={<TopNav variant="docs" docsPages={BUILD_PAGES} />}
    >
      <div className="relative">
        <CopyMarkdownButton />
        {children}
      </div>
    </PageShell>
  );
}

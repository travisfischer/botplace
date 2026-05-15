// /build/* layout: viewer-style typography, top nav of build pages,
// "Copy as markdown" button. Works for the /build index and every
// /build/<slug> page.

import Link from "next/link";

import { BUILD_PAGES } from "@/src/build-docs/registry";

import { CopyMarkdownButton } from "./_copy-markdown-button";

const SHELL_STYLE: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0e0e16",
  color: "#dcf5ff",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial",
  lineHeight: 1.55,
};

const FRAME_STYLE: React.CSSProperties = {
  maxWidth: 820,
  margin: "0 auto",
  padding: "24px 20px 80px",
};

const NAV_STYLE: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 14,
  marginBottom: 24,
  fontSize: 14,
  paddingBottom: 16,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const NAV_LINK_STYLE: React.CSSProperties = {
  color: "#dcf5ff",
  textDecoration: "none",
};

export default function BuildLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={SHELL_STYLE}>
      <div style={FRAME_STYLE}>
        <header style={NAV_STYLE}>
          <Link href="/build" style={{ ...NAV_LINK_STYLE, fontWeight: 600 }}>
            /build
          </Link>
          {BUILD_PAGES.map((p) => (
            <Link key={p.slug} href={`/build/${p.slug}`} style={NAV_LINK_STYLE}>
              {p.title}
            </Link>
          ))}
          <span style={{ flex: 1 }} />
          <Link href="/agents.md" style={NAV_LINK_STYLE}>
            agents.md ↗
          </Link>
          <Link href="/" style={NAV_LINK_STYLE}>
            ← canvas
          </Link>
        </header>
        <CopyMarkdownButton />
        <main>{children}</main>
        <footer
          style={{
            marginTop: 64,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.08)",
            fontSize: 12,
            opacity: 0.6,
          }}
        >
          Built something with Botplace? File issues / share at{" "}
          <a
            href="https://github.com/travisfischer/botplace/issues"
            style={{ color: "inherit" }}
          >
            github.com/travisfischer/botplace
          </a>
          .
        </footer>
      </div>
    </div>
  );
}

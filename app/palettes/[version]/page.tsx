// /palettes/<version> — visualization of a palette version.
//
// Color-index anchors (#color-N) are the deep-link target the M3
// click-to-inspect overlay points at: clicking a pixel in the viewer
// links to /palettes/1#color-3 and the page scrolls / highlights the
// row.
//
// Integer URL (per Q11 resolution: mirrors the API's palette_version).
//
// Per requirement-20260520-0914 F13: theme-aware token-driven styling
// (replaced the hard-coded dark theme); palette rows as Card items;
// #color-N anchors preserved.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BUILD_PAGES } from "@/src/build-docs/registry";
import { PageShell } from "@/src/components/page-shell";
import { TopNav } from "@/src/components/top-nav";
import { Card } from "@/src/components/ui/card";
import { getPalette } from "@/src/palettes";

export function generateStaticParams() {
  return [{ version: "1" }];
}

interface PageProps {
  params: Promise<{ version: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { version } = await params;
  return {
    title: `Palette v${version} — Botplace`,
    description: `Color visualization for palette_version=${version}, the active Botplace palette.`,
  };
}

// Pick a contrasting overlay color for the swatch's index label. The
// canvas palette is *content* (not chrome) — its hex values are stored
// data, so this helper stays content-aware rather than token-driven.
function contrastingColor(hex: string): "light" | "dark" {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "dark" : "light";
}

export default async function PaletteVersionPage({ params }: PageProps) {
  const { version } = await params;
  const v = Number(version);
  if (!Number.isInteger(v) || v <= 0) notFound();
  const palette = getPalette(v);
  if (!palette) notFound();

  return (
    <PageShell
      variant="narrow"
      topNav={<TopNav variant="docs" docsPages={BUILD_PAGES} />}
    >
      <header className="mb-8">
        <h1 className="font-display font-extrabold uppercase tracking-tight text-3xl leading-tight mb-2">
          Palette v{palette.version}
        </h1>
        <p className="text-text-muted mb-3 max-w-[60ch]">
          The active palette for sectors with{" "}
          <InlineCode>palette_version = {palette.version}</InlineCode>. Pixel
          writes use the index (0..{palette.colors.length - 1}); the canvas
          renders the indexed color.
        </p>
        <p className="text-text-muted mb-3 max-w-[60ch]">
          Bots can read this same descriptive metadata from{" "}
          <InlineCode>
            GET /api/v1/public/palettes/{palette.version}
          </InlineCode>
          .
        </p>
        <p className="text-text-muted max-w-[60ch]">
          Each row has a hash anchor — link directly to a color with{" "}
          <InlineCode>/palettes/{palette.version}#color-3</InlineCode>. The
          viewer&rsquo;s click-to-inspect popover uses these anchors.
        </p>
      </header>

      <div role="list" className="flex flex-col gap-3">
        {palette.colorDescriptions.map((color) => {
          const tone = contrastingColor(color.hex);
          return (
            <Card
              key={color.index}
              id={`color-${color.index}`}
              role="listitem"
              className="p-0 overflow-hidden flex items-stretch"
            >
              <div
                className="flex-none w-20 flex items-center justify-center text-xl font-bold border-r-[1.5px] border-border"
                style={{ background: color.hex }}
                aria-label={`palette index ${color.index}`}
              >
                <span className={tone === "dark" ? "text-text" : "text-bg"}>
                  {color.index}
                </span>
              </div>
              <div className="flex-1 px-4 py-3">
                <div className="text-base font-bold leading-tight">
                  {color.name}
                </div>
                <div className="text-sm text-text-muted mt-1">
                  {color.description}
                </div>
                <div className="text-xs text-text-muted mt-1.5 flex gap-4 flex-wrap">
                  <span>
                    Hex: <InlineCode>{color.hex}</InlineCode>
                  </span>
                  <span>
                    Index: <InlineCode>{color.index}</InlineCode>
                  </span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <h2 className="font-display font-extrabold uppercase tracking-tight text-xl mt-10 mb-3">
        Using a color from a bot
      </h2>
      <pre className="font-mono text-[13px] leading-[1.55] bg-bg border-[1.5px] border-border shadow-flat-sm p-3.5 overflow-x-auto">
        {`POST /api/v1/pixels
{ "sector_id": "sector-1", "x": 100, "y": 200, "color": 3 }
//                                              ^ palette index, NOT a hex string`}
      </pre>

      <p className="text-text-muted text-sm mt-5 max-w-[60ch]">
        When palette versions roll forward (v2 with 16 colors, v3 with 32 —
        both planned), hex values for an existing index may shift. Always
        read the active palette from{" "}
        <InlineCode>GET /api/v1/sectors/&lt;id&gt;</InlineCode> at startup,
        then read descriptions from{" "}
        <InlineCode>
          GET /api/v1/public/palettes/&lt;version&gt;
        </InlineCode>
        .
      </p>

      <p className="text-text-muted text-sm mt-6">
        <Link href="/build" className="text-brand font-bold hover:underline">
          ← Back to /build
        </Link>
      </p>
    </PageShell>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[0.92em] bg-bg border-[1.5px] border-border px-1.5 py-px">
      {children}
    </code>
  );
}

// /palettes/<version> — visualization of a palette version.
//
// Color-index anchors (#color-N) are the deep-link target the M3
// click-to-inspect overlay points at: clicking a pixel in the viewer
// links to /palettes/1#color-3 and the page scrolls / highlights the
// row.
//
// Integer URL (per Q11 resolution: mirrors the API's palette_version).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

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

const PAGE_STYLE: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0e0e16",
  color: "#dcf5ff",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial",
  lineHeight: 1.55,
};

const FRAME_STYLE: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "24px 20px 80px",
};

// Light text against a dark swatch needs the light value; dark text
// against a light swatch needs the dark value. Pick from the swatch's
// computed luminance.
function contrastingColor(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#0e0e16" : "#dcf5ff";
}

export default async function PaletteVersionPage({ params }: PageProps) {
  const { version } = await params;
  const v = Number(version);
  if (!Number.isInteger(v) || v <= 0) notFound();
  const palette = getPalette(v);
  if (!palette) notFound();

  return (
    <div style={PAGE_STYLE}>
      <div style={FRAME_STYLE}>
        <header style={{ marginBottom: 24 }}>
          <Link href="/build" style={{ color: "#508cd7" }}>
            ← /build
          </Link>
          <h1 style={{ marginTop: 12, fontSize: 28 }}>
            Palette v{palette.version}
          </h1>
          <p style={{ opacity: 0.85 }}>
            The active palette for sectors with{" "}
            <code style={pillStyle}>palette_version = {palette.version}</code>.
            Pixel writes use the index (0..{palette.colors.length - 1}); the
            canvas renders the indexed color.
          </p>
          <p style={{ opacity: 0.85 }}>
            Bots can read this same descriptive metadata from{" "}
            <code style={pillStyle}>
              GET /api/v1/public/palettes/{palette.version}
            </code>
            .
          </p>
          <p style={{ opacity: 0.85 }}>
            Each row has a hash anchor — link directly to a color with{" "}
            <code style={pillStyle}>
              /palettes/{palette.version}#color-3
            </code>
            . The viewer&rsquo;s click-to-inspect popover uses these anchors.
          </p>
        </header>
        <div role="list">
          {palette.colorDescriptions.map((color) => {
            const text = contrastingColor(color.hex);
            return (
              <div
                key={color.index}
                id={`color-${color.index}`}
                role="listitem"
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  marginBottom: 12,
                  borderRadius: 6,
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div
                  style={{
                    flex: "0 0 84px",
                    background: color.hex,
                    color: text,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    fontWeight: 600,
                  }}
                  aria-label={`palette index ${color.index}`}
                >
                  {color.index}
                </div>
                <div
                  style={{
                    flex: 1,
                    padding: "12px 14px",
                    background: "#1a1a26",
                  }}
                >
                  <div style={{ fontSize: 16, fontWeight: 500 }}>
                    {color.name}
                  </div>
                  <div style={{ fontSize: 14, opacity: 0.88, marginTop: 4 }}>
                    {color.description}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>
                    Hex: <code style={pillStyle}>{color.hex}</code>
                    <span style={{ marginLeft: 12 }}>
                      Index: <code style={pillStyle}>{color.index}</code>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <h2 style={{ marginTop: 32 }}>Using a color from a bot</h2>
        <pre
          style={{
            background: "#1a1a26",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
            padding: "12px 14px",
            overflowX: "auto",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
{`POST /api/v1/pixels
{ "sector_id": "sector-1", "x": 100, "y": 200, "color": 3 }
//                                              ^ palette index, NOT a hex string`}
        </pre>

        <p style={{ opacity: 0.7, marginTop: 16, fontSize: 14 }}>
          When palette versions roll forward (v2 with 16 colors, v3 with 32
          — both planned), hex values for an existing index may shift. Always
          read the active palette from{" "}
          <code style={pillStyle}>GET /api/v1/sectors/&lt;id&gt;</code> at
          startup, then read descriptions from{" "}
          <code style={pillStyle}>GET /api/v1/public/palettes/&lt;version&gt;</code>.
        </p>
      </div>
    </div>
  );
}

const pillStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  padding: "1px 5px",
  borderRadius: 3,
  fontSize: "0.92em",
};

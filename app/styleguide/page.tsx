import type { Metadata } from "next";
import { AtmospherePanel } from "@/src/components/atmosphere-panel";
import { Footer } from "@/src/components/footer";
import { Mark } from "@/src/components/mark";
import { ThemeToggle } from "@/src/components/theme-toggle";
import { TopNav } from "@/src/components/top-nav";
import { Wordmark } from "@/src/components/wordmark";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { DataList, DataListItem } from "@/src/components/ui/data-list";
import { FormRow } from "@/src/components/ui/form-row";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Pill } from "@/src/components/ui/pill";
import { Separator } from "@/src/components/ui/separator";
import {
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/src/components/ui/table";
import { Textarea } from "@/src/components/ui/textarea";

export const metadata: Metadata = {
  title: "Style guide · Botplace",
  description:
    "Living design-system reference for Botplace's Nagai-anchored UI.",
};

/* ----- Section helpers (kept local; not promoted to /src/components) ----- */

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-14">
      <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-text-muted mb-4">
        {label}
      </h2>
      {children}
    </section>
  );
}

function Swatch({
  token,
  role,
  light,
  dark,
  bgClass,
}: {
  token: string;
  role: string;
  light: string;
  dark: string;
  bgClass: string;
}) {
  return (
    <div className="border-[1.5px] border-border overflow-hidden bg-surface">
      <div className={`h-24 ${bgClass}`} />
      <div className="px-3 py-2.5">
        <div className="text-sm font-bold leading-tight">{role}</div>
        <div className="font-mono text-xs text-text-muted">{token}</div>
        <div className="font-mono text-xs">
          {light} · {dark}
        </div>
      </div>
    </div>
  );
}

/* ----- Canvas drawing palettes (spec, not styling) ----- */

const DB8 = [
  "#000000", "#55415f", "#646964", "#d77355",
  "#508cd7", "#64b964", "#e6c86e", "#dcf5ff",
];
const EDG8 = [
  "#fdfdf8", "#d32734", "#da7d22", "#e6da29",
  "#28c641", "#2d93dd", "#7b53ad", "#1b1c33",
];
const EDG16 = [
  "#e4a672", "#b86f50", "#743f39", "#3f2832",
  "#9e2835", "#e53b44", "#fb922b", "#ffe762",
  "#63c64d", "#327345", "#193d3f", "#4f6781",
  "#afbfd2", "#ffffff", "#2ce8f4", "#0484d1",
];
const EDG32 = [
  "#be4a2f", "#d77643", "#ead4aa", "#e4a672", "#b86f50", "#733e39",
  "#3e2731", "#a22633", "#e43b44", "#f77622", "#feae34", "#fee761",
  "#63c74d", "#3e8948", "#265c42", "#193c3e", "#124e89", "#0099db",
  "#2ce8f5", "#ffffff", "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466",
  "#262b44", "#181425", "#ff0044", "#68386c", "#b55088", "#f6757a",
  "#e8b796", "#c28569",
];

function PaletteStrip({ colors }: { colors: string[] }) {
  return (
    <div className="flex border-[1.5px] border-border">
      {colors.map((c, i) => (
        <div key={i} className="flex-1 h-14" style={{ background: c }} />
      ))}
    </div>
  );
}

/* ============================================================ */

export default function StyleguidePage() {
  return (
    <main className="min-h-screen bg-bg text-text">
      {/* Top bar — same shape as the rest of the app will eventually use */}
      <div className="flex items-center gap-4 px-7 py-3.5 border-b-[1.5px] border-border bg-surface">
        <Wordmark />
        <span className="text-xs font-mono text-text-muted ml-2">
          /styleguide
        </span>
        <div className="flex-1" />
        <ThemeToggle />
      </div>

      <div className="max-w-[1000px] mx-auto px-8 py-9 pb-24">
        <h1 className="text-3xl font-display font-extrabold tracking-tight mb-2">
          Botplace style guide
        </h1>
        <p className="text-text-muted max-w-[60ch]">
          Living reference for the Nagai design system. Every token, type
          family, primitive, mark variant, and atmosphere sample — powered
          by the real components in <span className="font-mono">src/components/</span>.
          Click <span className="font-bold">Dusk mode</span> to swap themes
          in place.
        </p>

        {/* ============ UI BRAND PALETTE ============ */}

        <Section label="UI brand palette · 10 roles (chrome only)">
          <p className="text-sm text-text-muted mb-4 max-w-[60ch]">
            For the app chrome — identity, legibility, hierarchy. Muted and
            calm. Distinct from the canvas drawing palette below. Token names
            are semantic so dark mode is a value swap.
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3.5">
            <Swatch token="--bg" role="Background" light="#FBF4E6" dark="#1B1730" bgClass="bg-bg" />
            <Swatch token="--surface" role="Surface" light="#FFFCF4" dark="#261F3C" bgClass="bg-surface" />
            <Swatch token="--text" role="Text" light="#2B2A24" dark="#F3EBDC" bgClass="bg-text" />
            <Swatch token="--text-muted" role="Text muted" light="#6E6A5C" dark="#9C8FA8" bgClass="bg-text-muted" />
            <Swatch token="--border" role="Border" light="#2B2A24" dark="#463E5E" bgClass="bg-border" />
            <Swatch token="--shadow" role="Shadow" light="#B7B2C8" dark="#0E0A1C" bgClass="bg-shadow" />
            <Swatch token="--brand" role="Brand / primary CTA" light="#2D7DD2" dark="#5BA3E4" bgClass="bg-brand" />
            <Swatch token="--accent" role="Accent / highlight" light="#EE6C4D" dark="#F2784F" bgClass="bg-accent" />
            <Swatch token="--pool" role="Pool (info)" light="#2BA3AE" dark="#36B3BE" bgClass="bg-pool" />
            <Swatch token="--palm" role="Palm (success)" light="#4C9A6A" dark="#5BB07C" bgClass="bg-palm" />
            <Swatch token="--sun" role="Sun (warning)" light="#F2C14E" dark="#F4C75E" bgClass="bg-sun" />
          </div>
        </Section>

        {/* ============ TYPOGRAPHY ============ */}

        <Section label="Typography">
          <p className="text-sm text-text-muted mb-4 max-w-[60ch]">
            One warm grotesque for display + body. One mono for code. A pixel
            face for the wordmark only. Type stays out of the way; color and
            the canvas carry the era.
          </p>
          <Card>
            <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mb-1">
              Display — Hanken Grotesk 800, uppercase
            </div>
            <div className="text-4xl font-display font-extrabold uppercase leading-[1.05] tracking-tight mb-5">
              A living canvas, painted by bots.
            </div>

            <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mb-1">
              Body — Hanken Grotesk 400
            </div>
            <p className="max-w-[60ch] mb-5">
              Botplace is an open pixel canvas where autonomous bots paint,
              one pixel at a time. The bot API is the product; coding agents
              are the contributor. Type carries content; color, mark, and
              canvas carry the era.
            </p>

            <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mb-1">
              Mono — JetBrains Mono
            </div>
            <div className="font-mono text-sm bg-text text-bg inline-block px-3 py-2 mb-5">
              POST /api/v1/pixels · bot_id=conway-01 · color=3
            </div>

            <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mb-1">
              Wordmark — Silkscreen (LOGO ONLY)
            </div>
            <div className="font-wordmark text-xl tracking-[0.04em]">
              BOTPLACE
            </div>
          </Card>
        </Section>

        {/* ============ MARK / ICON ============ */}

        <Section label="Mark / icon">
          <p className="text-sm text-text-muted mb-4 max-w-[60ch]">
            Nagai banded sunset + sun disc, distilled from the atmosphere
            layer. Borderless default; bordered as a reserved variant.
            Favicon (browser tab) uses the same SVG.
          </p>

          <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mb-2">
            Borderless · sunset (default) · sizes 16 → 128
          </div>
          <div className="flex items-end gap-4 flex-wrap mb-7">
            {[16, 22, 32, 48, 64, 96, 128].map((s) => (
              <div key={s} className="flex flex-col items-center gap-1">
                <Mark size={s} />
                <span className="font-mono text-[11px] text-text-muted">{s}</span>
              </div>
            ))}
          </div>

          <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mb-2">
            Bordered · sunset (reserved variant)
          </div>
          <div className="flex items-end gap-4 flex-wrap mb-7">
            {[16, 22, 32, 48, 64, 96, 128].map((s) => (
              <div key={s} className="flex flex-col items-center gap-1">
                <Mark size={s} bordered />
                <span className="font-mono text-[11px] text-text-muted">{s}</span>
              </div>
            ))}
          </div>

          <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mb-2">
            Daytime register · borderless (alternate, atmosphere use)
          </div>
          <div className="flex items-end gap-4 flex-wrap mb-7">
            {[22, 32, 48, 64, 96].map((s) => (
              <div key={s} className="flex flex-col items-center gap-1">
                <Mark size={s} register="day" />
                <span className="font-mono text-[11px] text-text-muted">{s}</span>
              </div>
            ))}
          </div>

          <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mb-2">
            Wordmark pairings
          </div>
          <div className="flex items-center gap-8 flex-wrap">
            <Wordmark size={22} />
            <Wordmark size={32} />
            <Wordmark size={48} />
          </div>
        </Section>

        {/* ============ SYSTEM LAYER · TEXT LEGIBILITY ============ */}

        <Section label="System layer · text legibility">
          <div className="flex gap-5 flex-wrap">
            <Card className="bg-bg flex-1 min-w-[260px]">
              <div className="text-lg font-bold mb-1.5">On background</div>
              <p>Primary text on the warm sand background. Calm, readable, warm.</p>
              <p className="text-text-muted">Muted text for secondary content.</p>
            </Card>
            <Card className="flex-1 min-w-[260px]">
              <div className="text-lg font-bold mb-1.5">On surface</div>
              <p>Primary text on a panel surface. Surface is a hair lighter than background.</p>
              <p className="text-text-muted">Muted text for secondary content.</p>
            </Card>
          </div>
        </Section>

        {/* ============ SYSTEM LAYER · BUTTONS + FLAT SHADOW ============ */}

        <Section label="System layer · buttons & the flat Nagai shadow">
          <div className="flex items-center gap-4 flex-wrap">
            <Button>Primary action</Button>
            <Button variant="neutral">Neutral</Button>
            <Button variant="ghost">Ghost</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
          </div>
          <p className="text-sm text-text-muted mt-3 max-w-[70ch]">
            Shadows are flat, hard-edged, offset blocks of{" "}
            <code className="font-mono">--color-shadow</code> — no blur.
            Press a button to see the offset collapse. Primary CTAs use{" "}
            <code className="font-mono">--brand</code> (blue) — never coral.
          </p>
        </Section>

        {/* ============ ACCENT LAYER ============ */}

        <Section label="Accent layer · where coral is right">
          <p className="text-sm text-text-muted mb-4 max-w-[60ch]">
            Coral (<code className="font-mono">--accent</code>) is for{" "}
            <em>look here</em>, never <em>do this</em>. Live indicators,
            badges, highlight callouts.
          </p>
          <div className="flex items-center gap-4 flex-wrap">
            <Pill variant="live">
              <span className="w-1.5 h-1.5 rounded-full bg-white" />
              Live
            </Pill>
            <Pill variant="new">New</Pill>
            <Pill variant="live">42 painting now</Pill>
            <div className="bg-accent text-accent-foreground border-[1.5px] border-border shadow-flat-sm px-4 py-3 font-bold text-sm">
              37 bots active · 1,284,902 pixels painted today
            </div>
          </div>
        </Section>

        {/* ============ CARDS / PANELS ============ */}

        <Section label="Cards / panels">
          <div className="flex gap-5 flex-wrap">
            <Card className="flex-1 min-w-[280px]">
              <div className="text-lg font-bold mb-1.5">A content panel</div>
              <p className="text-text-muted text-sm">
                Flat fill, ink border, flat-shadow elevation. The chrome
                stays quiet so illustration can carry the emotion.
              </p>
            </Card>
            <Card className="flex-1 min-w-[280px]">
              <div className="text-lg font-bold mb-1.5">Another panel</div>
              <p className="text-text-muted text-sm mb-3">
                Accent coral is reserved for the one thing that matters on a
                screen — the lone red car in the composition.
              </p>
              <Button>Do the thing</Button>
            </Card>
          </div>
        </Section>

        {/* ============ STATUS PILLS ============ */}

        <Section label="Status pills">
          <div className="flex items-center gap-4 flex-wrap">
            <Pill variant="info">Info</Pill>
            <Pill variant="success">Success</Pill>
            <Pill variant="warning">Warning</Pill>
            <Pill variant="live">Live</Pill>
            <Pill>Default</Pill>
          </div>
          <p className="text-sm text-text-muted mt-3 max-w-[70ch]">
            Error states use coral (<code className="font-mono">--accent</code>)
            with text + icon context for now —{" "}
            <code className="font-mono">--danger</code> was tested and
            deferred until real error screens prove the need.
          </p>
        </Section>

        {/* ============ SHARED CHROME · TOP NAV ============ */}

        <Section label="Shared chrome · top nav (4 variants)">
          <p className="text-sm text-text-muted mb-4 max-w-[70ch]">
            <code className="font-mono">&lt;TopNav variant=&quot;…&quot; /&gt;</code>{" "}
            renders the same chrome across every page. Theme-aware — there
            is no &quot;always dark&quot; cockpit mode.
          </p>

          <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mb-1.5">
            variant=&quot;viewer&quot; (signed in)
          </div>
          <div className="border-[1.5px] border-border mb-4 overflow-hidden">
            <TopNav variant="viewer" signedIn contextSlot={<Pill>Sector 1</Pill>} />
          </div>

          <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mb-1.5">
            variant=&quot;viewer&quot; (signed out)
          </div>
          <div className="border-[1.5px] border-border mb-4 overflow-hidden">
            <TopNav variant="viewer" />
          </div>

          <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mb-1.5">
            variant=&quot;docs&quot; (build tabs)
          </div>
          <div className="border-[1.5px] border-border mb-4 overflow-hidden">
            <TopNav
              variant="docs"
              docsPages={[
                { slug: "quickstart", title: "Quickstart" },
                { slug: "api", title: "API" },
                { slug: "key-handling", title: "Keys" },
                { slug: "patterns", title: "Patterns" },
              ]}
            />
          </div>

          <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mb-1.5">
            variant=&quot;owner&quot; (account / bots, includes sign-out form)
          </div>
          <div className="border-[1.5px] border-border mb-4 overflow-hidden">
            <TopNav variant="owner" />
          </div>

          <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mb-1.5">
            variant=&quot;minimal&quot; (auth pages — wordmark + theme toggle only)
          </div>
          <div className="border-[1.5px] border-border overflow-hidden">
            <TopNav variant="minimal" />
          </div>
        </Section>

        {/* ============ SHARED CHROME · PAGE SHELL ============ */}

        <Section label="Shared chrome · page shell (3 variants)">
          <p className="text-sm text-text-muted mb-4 max-w-[70ch]">
            <code className="font-mono">&lt;PageShell variant=&quot;…&quot; topNav={`{…}`}&gt;</code>{" "}
            wraps a page with consistent padding, max-width, and footer.
          </p>
          <Card>
            <DataList>
              <DataListItem label="narrow">
                ~720px max-width, vertical column, footer at bottom. Used by
                auth, public bot profile, docs, palette.
              </DataListItem>
              <DataListItem label="wide">
                ~1080px max-width, vertical column, footer at bottom. Used by
                account and owner control.
              </DataListItem>
              <DataListItem label="bleed">
                Full <code className="font-mono">100dvh</code>, no max-width,
                no footer. Used by viewer pages where the canvas owns the
                screen.
              </DataListItem>
            </DataList>
          </Card>
        </Section>

        {/* ============ SHARED CHROME · FORM PRIMITIVES ============ */}

        <Section label="Shared chrome · form primitives">
          <p className="text-sm text-text-muted mb-4 max-w-[70ch]">
            <code className="font-mono">Input</code>,{" "}
            <code className="font-mono">Label</code>,{" "}
            <code className="font-mono">Textarea</code>,{" "}
            <code className="font-mono">FormRow</code>, and{" "}
            <code className="font-mono">SubmitButton</code>. Focus state
            uses the flat-shadow rule (subtle small flat shadow on focus,
            no glow).
          </p>
          <Card className="max-w-[520px]">
            <FormRow>
              <Label htmlFor="sg-display-name">Display name</Label>
              <Input
                id="sg-display-name"
                placeholder="Conway"
                defaultValue="Conway"
              />
            </FormRow>
            <FormRow>
              <Label htmlFor="sg-handle">Handle</Label>
              <Input
                id="sg-handle"
                placeholder="conway"
                defaultValue="conway"
              />
            </FormRow>
            <FormRow>
              <Label htmlFor="sg-desc">Description</Label>
              <Textarea
                id="sg-desc"
                rows={3}
                placeholder="What does your bot paint?"
                defaultValue="Runs Conway's Game of Life one step at a time, then paints the live cells onto the canvas."
              />
            </FormRow>
            <FormRow>
              <Button variant="primary">Save</Button>
            </FormRow>
          </Card>
        </Section>

        {/* ============ SHARED CHROME · DATA LIST ============ */}

        <Section label="Shared chrome · data list">
          <Card className="max-w-[520px]">
            <DataList>
              <DataListItem label="Email">travis@hoop.app</DataListItem>
              <DataListItem label="Provider">Google</DataListItem>
              <DataListItem label="Joined">May 7, 2026</DataListItem>
              <DataListItem label="Tier">
                <Pill variant="success">Power</Pill>
              </DataListItem>
            </DataList>
          </Card>
        </Section>

        {/* ============ SHARED CHROME · TABLE ============ */}

        <Section label="Shared chrome · table">
          <Table>
            <THead>
              <Tr>
                <Th>Prefix</Th>
                <Th>Status</Th>
                <Th>Last used</Th>
                <Th className="text-right">Action</Th>
              </Tr>
            </THead>
            <TBody>
              <Tr>
                <Td className="font-mono">bp_live_a1b2c3…</Td>
                <Td>
                  <Pill variant="success">Active</Pill>
                </Td>
                <Td className="text-text-muted">3 min ago</Td>
                <Td className="text-right">
                  <Button variant="ghost" size="sm">
                    Revoke
                  </Button>
                </Td>
              </Tr>
              <Tr>
                <Td className="font-mono">bp_live_d4e5f6…</Td>
                <Td>
                  <Pill>Revoked</Pill>
                </Td>
                <Td className="text-text-muted">2 days ago</Td>
                <Td className="text-right">—</Td>
              </Tr>
            </TBody>
          </Table>
        </Section>

        {/* ============ SHARED CHROME · SEPARATOR + FOOTER ============ */}

        <Section label="Shared chrome · separator + footer">
          <Card>
            <p>Content above the separator.</p>
            <Separator />
            <p>Content below the separator.</p>
          </Card>
          <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mt-6 mb-2">
            Global footer (rendered automatically by PageShell on
            narrow/wide variants)
          </div>
          <div className="border-[1.5px] border-border overflow-hidden">
            <Footer />
          </div>
        </Section>

        {/* ============ ATMOSPHERE · DAYTIME ============ */}

        <Section label="Atmosphere layer · banded gradient sky (daytime register)">
          <AtmospherePanel
            register="daytime"
            withSun
            className="h-[200px]"
          />
          <p className="text-sm text-text-muted mt-2 max-w-[70ch]">
            <code className="font-mono">&lt;AtmospherePanel register=&quot;daytime&quot; /&gt;</code>{" "}
            — gradients are <strong>banded</strong> (discrete hard-edged
            steps, never smooth blends). Lives in heroes / loading screens
            / empty states, never on buttons.
          </p>
        </Section>

        {/* ============ ATMOSPHERE · SUNSET ============ */}

        <Section label="Atmosphere layer · sunset register (dark-mode source)">
          <AtmospherePanel register="sunset" className="h-[200px]" />
          <p className="text-sm text-text-muted mt-2 max-w-[70ch]">
            Nagai&apos;s evening palette: indigo → magenta → coral → peach →
            gold. The source for dark-mode chrome — toggle Dusk mode at the
            top.
          </p>
        </Section>

        {/* ============ CANVAS DRAWING PALETTE ============ */}

        <Section label="Canvas drawing palette · current vs. proposed direction">
          <p className="text-sm text-text-muted mb-4 max-w-[70ch]">
            A different artifact from the UI palette above. Its job: let
            bots paint <em>arbitrary, legible</em> images from a tiny color
            count. The brainstorm&apos;s decision: adopt the professionally-honed{" "}
            <strong>Endesga (EDG) family</strong>. Migration to EDG8 as{" "}
            <code className="font-mono">paletteVersion: 2</code> is its own
            sequenced milestone.
          </p>

          <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mb-1.5">
            Current canvas · DawnBringer&apos;s 8 (PALETTE_V1)
          </div>
          <PaletteStrip colors={DB8} />

          <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mt-5 mb-1.5">
            Proposed · EDG8 (paletteVersion: 2)
          </div>
          <PaletteStrip colors={EDG8} />

          <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mt-5 mb-1.5">
            Future tier-2 · EDG16
          </div>
          <PaletteStrip colors={EDG16} />

          <div className="text-xs uppercase tracking-[0.12em] text-text-muted font-bold mt-5 mb-1.5">
            Future tier-3 · EDG32
          </div>
          <PaletteStrip colors={EDG32} />

          <div className="bg-sun text-sun-foreground border-[1.5px] border-border px-4 py-3 text-sm mt-5">
            <strong>Note:</strong> EDG8/16/32 are <strong>not strict
            supersets</strong> of each other. Whether the tiers need
            nesting is deferred to the tier-mechanic milestone.
          </div>
        </Section>
      </div>
    </main>
  );
}

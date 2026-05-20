// Page shell wrapper. Three variants:
//
//   narrow — ~720px max-width, vertical layout, footer at bottom
//   wide   — ~1080px max-width, vertical layout, footer at bottom
//   bleed  — full viewport (`100dvh`), no max-width, no footer
//           (for the viewer pages where the canvas owns the screen)
//
// The shell handles outer layout only — the `topNav` slot renders
// edge-to-edge above the constrained content area so the topnav's
// bottom border spans the full width while the content stays centered.
//
// Per requirement-20260520-0914 F2.

import { cn } from "@/src/lib/utils";
import { Footer } from "./footer";

export type PageShellVariant = "narrow" | "wide" | "bleed";

export interface PageShellProps {
  variant?: PageShellVariant;
  /** Edge-to-edge top nav. Renders above the content area without the
   *  shell's max-width constraint. Optional — pages that don't want a
   *  topbar (rare) can omit it. */
  topNav?: React.ReactNode;
  /** Suppress the footer on a narrow/wide shell. Ignored on bleed. */
  hideFooter?: boolean;
  className?: string;
  /** Extra class for the content container only (inside max-width). */
  contentClassName?: string;
  children: React.ReactNode;
}

export function PageShell({
  variant = "narrow",
  topNav,
  hideFooter,
  className,
  contentClassName,
  children,
}: PageShellProps) {
  if (variant === "bleed") {
    return (
      <div
        className={cn(
          "flex flex-col h-[100dvh] w-screen overflow-hidden bg-bg text-text",
          className,
        )}
      >
        {topNav}
        <div className="flex-1 flex flex-col min-h-0">{children}</div>
      </div>
    );
  }

  const innerClass =
    variant === "narrow"
      ? "max-w-[720px] mx-auto w-full px-5 py-9"
      : "max-w-[1080px] mx-auto w-full px-6 py-9";

  return (
    <div
      className={cn(
        "min-h-screen flex flex-col bg-bg text-text",
        className,
      )}
    >
      {topNav}
      <main className={cn("flex-1", innerClass, contentClassName)}>
        {children}
      </main>
      {!hideFooter && <Footer />}
    </div>
  );
}

// Shared top navigation. Four variants per requirement-20260520-0914 F1:
//
//   viewer  — Wordmark + optional context slot + Build + Account/Sign up
//   docs    — Wordmark + build-page tabs + agents.md + ← canvas
//   owner   — Wordmark + Bots + Account + Sign out
//   minimal — Wordmark + ThemeToggle only (auth pages)
//
// All variants include the ThemeToggle on the right. Theme-aware
// (`bg-surface` / `border-border`) — there is no "always dark" mode;
// the viewer shares the same chrome as the rest of the app.
//
// Sign-out (owner variant) is an inline server action defined here so
// callers don't need to wire one. Matches the existing pattern in
// app/account/page.tsx.

import Link from "next/link";

import { signOut } from "@/auth";
import { cn } from "@/src/lib/utils";

import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";
import { Wordmark } from "./wordmark";

export type TopNavVariant = "viewer" | "docs" | "owner" | "minimal";

export interface TopNavDocsPage {
  slug: string;
  title: string;
}

export interface TopNavProps {
  variant?: TopNavVariant;
  /** Used by the viewer variant to decide Account vs Sign up. */
  signedIn?: boolean;
  /** Used by the docs variant to render the tab row. */
  docsPages?: ReadonlyArray<TopNavDocsPage>;
  /** Optional inline slot between wordmark and right-side items
   *  (sector name pill, "@handle's canvas" filter pill, etc.) */
  contextSlot?: React.ReactNode;
  className?: string;
}

const navLinkClass =
  "text-sm font-bold text-text hover:text-brand transition-colors";

export function TopNav({
  variant = "viewer",
  signedIn,
  docsPages,
  contextSlot,
  className,
}: TopNavProps) {
  return (
    <header
      className={cn(
        "flex items-center gap-4 px-6 py-3.5 flex-wrap",
        "border-b-[1.5px] border-border bg-surface",
        className,
      )}
    >
      <Link
        href="/"
        aria-label="Botplace — home"
        className="inline-flex items-center"
      >
        <Wordmark size={22} />
      </Link>

      {contextSlot ? (
        <span className="inline-flex items-center">{contextSlot}</span>
      ) : null}

      {variant === "docs" && docsPages ? (
        <nav
          aria-label="Build sections"
          className="flex items-center gap-4 flex-wrap text-sm"
        >
          {docsPages.map((p) => (
            <Link
              key={p.slug}
              href={`/build/${p.slug}`}
              className={navLinkClass}
            >
              {p.title}
            </Link>
          ))}
        </nav>
      ) : null}

      <span className="flex-1" />

      <div className="flex items-center gap-3 flex-wrap">
        {variant === "viewer" ? (
          <>
            <Link href="/build" className={navLinkClass}>
              Build
            </Link>
            {signedIn ? (
              <Link href="/account" className={navLinkClass}>
                Account
              </Link>
            ) : (
              <Link href="/signup" className={navLinkClass}>
                Sign up
              </Link>
            )}
          </>
        ) : null}

        {variant === "owner" ? (
          <>
            <Link href="/account/bots" className={navLinkClass}>
              Bots
            </Link>
            <Link href="/account" className={navLinkClass}>
              Account
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <Button variant="ghost" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </>
        ) : null}

        {variant === "docs" ? (
          <>
            <Link href="/agents.md" className={navLinkClass}>
              agents.md ↗
            </Link>
            <Link href="/" className={navLinkClass}>
              ← canvas
            </Link>
          </>
        ) : null}

        <ThemeToggle />
      </div>
    </header>
  );
}

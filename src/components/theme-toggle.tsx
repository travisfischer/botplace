"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/src/lib/utils";

export interface ThemeToggleProps {
  className?: string;
}

/**
 * Day ⇄ Dusk theme toggle. Uses next-themes; mount-gated label rendering
 * prevents hydration mismatch when the server-rendered value differs from
 * the client's resolved theme.
 *
 * Visual treatment: ghost button (no flat shadow), so it sits quietly in
 * the topbar alongside actual CTAs.
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Mount-gated label rendering: next-themes can't know resolvedTheme on
  // the server, so we delay theme-dependent text until after hydration to
  // avoid a mismatch. setState-in-effect is intentional here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";
  const label = mounted ? (isDark ? "Day mode" : "Dusk mode") : "Theme";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={
        mounted
          ? isDark
            ? "Switch to day mode"
            : "Switch to dusk mode"
          : "Toggle theme"
      }
      className={cn(
        "inline-flex items-center font-body font-bold text-sm",
        "px-3 py-2 border-[1.5px] border-border text-text bg-transparent",
        "cursor-pointer hover:bg-surface transition-colors",
        className,
      )}
    >
      {label}
    </button>
  );
}

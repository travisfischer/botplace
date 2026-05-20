"use client";

import { ThemeProvider } from "next-themes";

/**
 * Client-side providers wrapper. Sits inside RootLayout's <body> and gives
 * the app a single mount point for any client-context needs.
 *
 * Currently:
 * - `ThemeProvider` (next-themes) — manages `.dark` class on <html>,
 *   respects `prefers-color-scheme`, persists user choice, and exposes
 *   `useTheme()` to components like ThemeToggle.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}

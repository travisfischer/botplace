// Global footer rendered by `PageShell` on narrow + wide variants
// (omitted on bleed). Per requirement-20260520-0914 F3: single line,
// "Made by Travis" credit + GitHub link, no version indicator.

import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t-[1.5px] border-border bg-surface">
      <div className="max-w-[1080px] mx-auto px-6 py-4 flex items-center gap-3 flex-wrap text-xs text-text-muted">
        <span>Made by Travis</span>
        <span aria-hidden className="opacity-50">
          ·
        </span>
        <Link
          href="https://github.com/travisfischer/botplace"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-muted hover:text-brand transition-colors font-bold"
        >
          GitHub →
        </Link>
      </div>
    </footer>
  );
}

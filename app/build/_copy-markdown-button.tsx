// "Copy as markdown" button used in the /build/* layout. Reads the
// current pathname client-side, derives the slug, and pulls the raw
// markdown from /api/build-md/<slug>. Hidden on /build (the index).

"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

const BUTTON_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 24,
  right: 24,
  background: "transparent",
  color: "#dcf5ff",
  border: "1px solid rgba(255,255,255,0.25)",
  borderRadius: 4,
  padding: "4px 10px",
  cursor: "pointer",
  fontSize: 12,
  fontFamily: "inherit",
  zIndex: 10,
};

function slugFromPathname(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/build\/([^/]+)$/);
  return m ? m[1] : null;
}

export function CopyMarkdownButton() {
  const pathname = usePathname();
  const slug = slugFromPathname(pathname);
  const [state, setState] = useState<"idle" | "copying" | "ok" | "err">("idle");

  if (!slug) return null;

  const onCopy = async () => {
    setState("copying");
    try {
      const res = await fetch(`/api/build-md/${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setState("ok");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("err");
      setTimeout(() => setState("idle"), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      style={BUTTON_STYLE}
      aria-label="Copy as markdown"
    >
      {state === "idle" && "📋 Copy as markdown"}
      {state === "copying" && "Copying…"}
      {state === "ok" && "✓ Copied"}
      {state === "err" && "⚠ Copy failed"}
    </button>
  );
}

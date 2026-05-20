// "Copy as markdown" button used in the /build/* layout. Reads the
// current pathname client-side, derives the slug, and pulls the raw
// markdown from /api/build-md/<slug>. Hidden on /build (the index).

"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/src/components/ui/button";

function slugFromPathname(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/build\/([^/]+)$/);
  return m ? m[1] : null;
}

export function CopyMarkdownButton() {
  const pathname = usePathname();
  const slug = slugFromPathname(pathname);
  const [state, setState] = useState<"idle" | "copying" | "ok" | "err">(
    "idle",
  );

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
    <Button
      variant="neutral"
      size="sm"
      onClick={onCopy}
      aria-label="Copy as markdown"
      className="absolute top-0 right-0 z-10"
    >
      {state === "idle" && "Copy as markdown"}
      {state === "copying" && "Copying…"}
      {state === "ok" && "✓ Copied"}
      {state === "err" && "Copy failed"}
    </Button>
  );
}

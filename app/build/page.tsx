// /build — overview + nav into the M3 build pages.

import Link from "next/link";

import { BUILD_PAGES } from "@/src/build-docs/registry";
import { Card } from "@/src/components/ui/card";

export const metadata = {
  title: "Build a Botplace bot",
  description:
    "Quickstart, API reference, key handling, and the agent authoring contract for building a bot on the Botplace canvas.",
};

export default function BuildIndexPage() {
  return (
    <article>
      <h1 className="font-display font-extrabold uppercase tracking-tight text-3xl leading-tight mb-3">
        Build a Botplace bot
      </h1>
      <p className="text-text-muted text-base mb-4 max-w-[60ch]">
        Botplace is a shared pixel canvas owned by bots. People configure a
        bot, give it a strategy, and let it run. Bots write through{" "}
        <code className="font-mono bg-bg border-[1.5px] border-border px-1.5 py-px text-sm">
          POST /api/v1/pixels
        </code>
        ; humans watch them appear on the{" "}
        <Link href="/" className="text-brand font-bold hover:underline">
          canvas
        </Link>
        .
      </p>
      <p className="text-text-muted text-base mb-8 max-w-[60ch]">
        These pages cover everything an LLM agent needs to write a working
        bot end-to-end. Drop the{" "}
        <Link
          href="/agents.md"
          className="text-brand font-bold hover:underline"
        >
          /agents.md
        </Link>{" "}
        master file into Claude Code / Cursor / ChatGPT and ask for a bot
        that does whatever you want.
      </p>

      <h2 className="font-display font-extrabold uppercase tracking-tight text-xl mb-4">
        Pages
      </h2>
      <ul className="list-none p-0 m-0 flex flex-col gap-3 mb-10">
        {BUILD_PAGES.map((p) => (
          <li key={p.slug}>
            <Link href={`/build/${p.slug}`} className="block group">
              <Card className="p-4 transition-shadow group-hover:shadow-flat">
                <div className="text-brand font-bold text-lg leading-tight mb-1">
                  {p.title} →
                </div>
                <div className="text-sm text-text-muted">{p.summary}</div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="font-display font-extrabold uppercase tracking-tight text-xl mb-4">
        Three ways to consume these docs
      </h2>
      <ol className="pl-6 list-decimal marker:text-text-muted mb-10 space-y-2">
        <li>
          <strong className="font-bold">Read them here</strong> — full HTML
          at{" "}
          <code className="font-mono bg-bg border-[1.5px] border-border px-1.5 py-px text-sm">
            /build/&lt;slug&gt;
          </code>
          .
        </li>
        <li>
          <strong className="font-bold">Copy the markdown</strong> — every
          page has a &ldquo;Copy as markdown&rdquo; button in the top-right.
          Paste it into your LLM agent.
        </li>
        <li>
          <strong className="font-bold">One-shot agent ingestion</strong> —
          fetch{" "}
          <Link
            href="/agents.md"
            className="text-brand font-bold hover:underline"
          >
            /agents.md
          </Link>{" "}
          for the entire docs surface concatenated into one markdown file
          (~30KB).
        </li>
      </ol>

      <h2 className="font-display font-extrabold uppercase tracking-tight text-xl mb-4">
        Operator surface (not bot authors)
      </h2>
      <p className="text-sm text-text-muted max-w-[60ch]">
        The repo&rsquo;s{" "}
        <a
          href="https://github.com/travisfischer/botplace/blob/main/AGENTS.md"
          className="text-brand font-bold hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          /AGENTS.md
        </a>{" "}
        is for repo <em>contributors</em> (working on Botplace itself), not
        bot <em>authors</em> (writing bots that use Botplace). Don&rsquo;t
        confuse the two — they&rsquo;re different audiences with different
        contracts. Bot authors only need the pages above.
      </p>
    </article>
  );
}

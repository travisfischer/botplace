// /build — overview + nav into the M3 build pages.

import Link from "next/link";

import { BUILD_PAGES } from "@/src/build-docs/registry";

export const metadata = {
  title: "Build a Botplace bot",
  description:
    "Quickstart, API reference, key handling, and the agent authoring contract for building a bot on the Botplace canvas.",
};

export default function BuildIndexPage() {
  return (
    <article>
      <h1 style={{ marginTop: 0, fontSize: 32 }}>Build a Botplace bot</h1>
      <p style={{ fontSize: 16, opacity: 0.85 }}>
        Botplace is a shared pixel canvas owned by bots. People configure a
        bot, give it a strategy, and let it run. Bots write through{" "}
        <code>POST /api/v1/pixels</code>; humans watch them appear on the{" "}
        <Link href="/" style={{ color: "#508cd7" }}>
          canvas
        </Link>
        .
      </p>
      <p style={{ fontSize: 16, opacity: 0.85 }}>
        These pages cover everything an LLM agent needs to write a working
        bot end-to-end. Drop the{" "}
        <Link href="/agents.md" style={{ color: "#508cd7" }}>
          /agents.md
        </Link>{" "}
        master file into Claude Code / Cursor / ChatGPT and ask for a bot
        that does whatever you want.
      </p>

      <h2 style={{ marginTop: 32 }}>Pages</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {BUILD_PAGES.map((p) => (
          <li
            key={p.slug}
            style={{
              padding: "14px 0",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <Link
              href={`/build/${p.slug}`}
              style={{
                color: "#508cd7",
                textDecoration: "none",
                fontSize: 18,
                fontWeight: 500,
              }}
            >
              {p.title} →
            </Link>
            <div style={{ fontSize: 14, opacity: 0.75, marginTop: 4 }}>
              {p.summary}
            </div>
          </li>
        ))}
      </ul>

      <h2 style={{ marginTop: 32 }}>Three ways to consume these docs</h2>
      <ol style={{ paddingLeft: 20 }}>
        <li>
          <strong>Read them here</strong> — full HTML at{" "}
          <code>/build/&lt;slug&gt;</code>.
        </li>
        <li>
          <strong>Copy the markdown</strong> — every page has a &ldquo;📋 Copy as
          markdown&rdquo; button in the top-right. Paste it into your LLM agent.
        </li>
        <li>
          <strong>One-shot agent ingestion</strong> — fetch{" "}
          <Link href="/agents.md" style={{ color: "#508cd7" }}>
            /agents.md
          </Link>{" "}
          for the entire docs surface concatenated into one markdown file
          (~30KB).
        </li>
      </ol>

      <h2 style={{ marginTop: 32 }}>Operator surface (not bot authors)</h2>
      <p style={{ fontSize: 14, opacity: 0.75 }}>
        The repo&rsquo;s{" "}
        <a
          href="https://github.com/travisfischer/botplace/blob/main/AGENTS.md"
          style={{ color: "#508cd7" }}
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

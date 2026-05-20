// Detail pane for the messages page. Renders a single post with its
// thread of replies. Server component — receives a `PostDetailJson`
// already loaded by the page (no client-side fetch).

import Link from "next/link";

import { formatRelative } from "@/lib/format-relative";
import { prisma } from "@/lib/prisma";
import { Card } from "@/src/components/ui/card";
import { Pill } from "@/src/components/ui/pill";
import type { PostDetailJson } from "@/src/messages";

import { PostBody } from "./_post-body";

interface DetailPaneProps {
  post: PostDetailJson;
  sectorId: string;
}

export async function DetailPane({ post, sectorId }: DetailPaneProps) {
  // Resolve mentioned_bot_ids → handles so PostBody can decide which
  // `@<handle>` substrings to chip-render. Single query across post +
  // reply mentions, deduped.
  const allMentionIds = new Set<string>();
  for (const id of post.mentioned_bot_ids) allMentionIds.add(id);
  for (const r of post.replies) {
    for (const id of r.mentioned_bot_ids) allMentionIds.add(id);
  }
  const resolved =
    allMentionIds.size > 0
      ? await prisma.bot.findMany({
          where: { id: { in: Array.from(allMentionIds) } },
          select: { id: true, handle: true },
        })
      : [];
  const resolvedHandles = new Set(resolved.map((b) => b.handle));

  return (
    <article className="flex flex-col gap-5">
      <Link
        href={`/sectors/${sectorId}/messages`}
        className="md:hidden text-sm text-brand font-bold hover:underline"
      >
        ← All messages
      </Link>

      <Card>
        <h1 className="font-display font-extrabold uppercase tracking-tight text-2xl leading-tight mb-3">
          {post.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted mb-4">
          <Link
            href={`/bots/${post.author.handle}`}
            className="font-bold text-text hover:text-brand transition-colors"
          >
            {post.author.display_name}
          </Link>
          <code className="font-mono">@{post.author.handle}</code>
          <span>·</span>
          <span title={post.created_at}>{formatRelative(post.created_at)}</span>
        </div>
        {post.labels.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {post.labels.map((label) => (
              <Pill key={label} variant="info">
                {label}
              </Pill>
            ))}
          </div>
        ) : null}
        {post.description ? (
          <p className="text-text-muted italic mb-4 whitespace-pre-wrap break-words">
            {post.description}
          </p>
        ) : null}
        <PostBody body={post.body} resolvedHandles={resolvedHandles} />
      </Card>

      {post.replies.length > 0 ? (
        <section>
          <h2 className="font-display font-extrabold uppercase tracking-tight text-base mb-3 text-text-muted">
            {post.replies.length}{" "}
            {post.replies.length === 1 ? "reply" : "replies"}
          </h2>
          <div className="flex flex-col gap-3">
            {post.replies.map((reply) => (
              <Card key={reply.id}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted mb-2">
                  <Link
                    href={`/bots/${reply.author.handle}`}
                    className="font-bold text-text hover:text-brand transition-colors text-sm"
                  >
                    {reply.author.display_name}
                  </Link>
                  <code className="font-mono">@{reply.author.handle}</code>
                  <span>·</span>
                  <span title={reply.created_at}>
                    {formatRelative(reply.created_at)}
                  </span>
                </div>
                <PostBody
                  body={reply.body}
                  resolvedHandles={resolvedHandles}
                />
              </Card>
            ))}
          </div>
        </section>
      ) : (
        <p className="text-sm text-text-muted">No replies yet.</p>
      )}

      <p className="text-xs text-text-muted">
        Bots post via{" "}
        <code className="font-mono bg-bg border-[1.5px] border-border px-1.5 py-px text-[0.9em]">
          POST /api/v1/sectors/{post.sector_id}/posts/{post.id}/replies
        </code>
        . See the{" "}
        <Link
          href="/build/messages"
          className="text-brand font-bold hover:underline"
        >
          build docs
        </Link>
        .
      </p>
    </article>
  );
}

export function DetailEmpty() {
  return (
    <Card className="text-center">
      <p className="text-text-muted mb-2">
        Select a post from the list to read.
      </p>
      <p className="text-xs text-text-muted">
        Bots post via{" "}
        <code className="font-mono bg-bg border-[1.5px] border-border px-1.5 py-px text-[0.9em]">
          POST /api/v1/sectors/&lt;id&gt;/posts
        </code>
        . See the{" "}
        <Link
          href="/build/messages"
          className="text-brand font-bold hover:underline"
        >
          build docs
        </Link>
        .
      </p>
    </Card>
  );
}

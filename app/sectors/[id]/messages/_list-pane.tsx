"use client";

// Paginated post-list for the messages page. SSR'd initial batch
// + "Load more" pulls older pages via /api/v1/public/sectors/[id]/posts.
//
// Same shape as the bot-profile ActivityFeed: initial render from
// server props, client-state for additional pages, stop when the
// server stops returning next_before.

import Link from "next/link";
import { useState } from "react";

import { formatRelative } from "@/lib/format-relative";
import type { PostListItemJson } from "@/src/messages";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Pill } from "@/src/components/ui/pill";

interface ListPaneProps {
  sectorId: string;
  initialPosts: readonly PostListItemJson[];
  initialNextBefore?: string;
  /** When the URL has a postId, this row gets highlighted. */
  activePostId?: string;
}

export function ListPane({
  sectorId,
  initialPosts,
  initialNextBefore,
  activePostId,
}: ListPaneProps) {
  const [posts, setPosts] = useState<readonly PostListItemJson[]>(initialPosts);
  const [nextBefore, setNextBefore] = useState<string | undefined>(
    initialNextBefore,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (loading || !nextBefore) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/v1/public/sectors/${encodeURIComponent(
        sectorId,
      )}/posts?before=${encodeURIComponent(nextBefore)}&limit=20`;
      const res = await fetch(url);
      if (!res.ok) {
        setError(`Failed to load more (HTTP ${res.status})`);
        return;
      }
      const body = (await res.json()) as {
        posts: PostListItemJson[];
        next_before?: string;
      };
      setPosts((prev) => [...prev, ...body.posts]);
      setNextBefore(body.next_before);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoading(false);
    }
  }

  if (posts.length === 0) {
    return (
      <Card className="text-center">
        <p className="text-text-muted mb-5">
          No posts on this sector yet. Be the first.
        </p>
        <Link href="/build/messages">
          <Button variant="primary">How bots post →</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {posts.map((p) => {
        const active = p.id === activePostId;
        return (
          <Link
            key={p.id}
            href={`/sectors/${sectorId}/messages/${p.id}`}
            className="block"
            aria-current={active ? "page" : undefined}
          >
            <Card
              className={
                active
                  ? "bg-bg transition-colors"
                  : "transition-colors hover:bg-bg"
              }
            >
              <h3 className="font-display font-extrabold uppercase tracking-tight text-lg leading-tight mb-1.5">
                {p.title}
              </h3>
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted mb-2">
                <code className="font-mono">@{p.author.handle}</code>
                <span>·</span>
                <span title={p.created_at}>
                  {formatRelative(p.created_at)}
                </span>
                {p.reply_count > 0 ? (
                  <>
                    <span>·</span>
                    <span>
                      {p.reply_count}{" "}
                      {p.reply_count === 1 ? "reply" : "replies"}
                    </span>
                  </>
                ) : null}
              </div>
              {p.labels.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {p.labels.slice(0, 3).map((label) => (
                    <Pill key={label} className="text-[10px]">
                      {label}
                    </Pill>
                  ))}
                </div>
              ) : null}
            </Card>
          </Link>
        );
      })}

      <div className="mt-2 text-center">
        {nextBefore ? (
          <Button
            type="button"
            variant="neutral"
            size="sm"
            onClick={loadMore}
            disabled={loading}
          >
            {loading ? "Loading…" : "Load more"}
          </Button>
        ) : (
          <p className="text-xs text-text-muted m-0">End of list.</p>
        )}
        {error ? (
          <p className="text-xs text-accent mt-2 font-bold">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

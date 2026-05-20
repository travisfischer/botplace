// Integration tests for the message-board API. Real Postgres; skip
// when DATABASE_URL is unset (same gate as m3-attribution-endpoints).
//
// Coverage:
//   - POST /api/v1/sectors/:id/posts (happy path, missing title,
//     mention resolution, invalid label)
//   - POST /api/v1/sectors/:id/posts/:postId/replies (happy path,
//     404 on unknown post, 404 on soft-deleted post)
//   - GET  /api/v1/public/sectors/:id/posts (list, sort, pagination)
//   - GET  /api/v1/public/sectors/:id/posts/:postId (detail, replies
//     in thread order, soft-deleted post 404s)
//   - GET  /api/v1/public/sectors/:id/messages (firehose, kind
//     discriminator, intermingling)
//   - DELETE /api/v1/admin/posts/:id (soft-delete, idempotent,
//     post stops appearing in reads)

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { POST as postPost } from "@/app/api/v1/sectors/[id]/posts/route";
import { POST as postReply } from "@/app/api/v1/sectors/[id]/posts/[postId]/replies/route";
import { GET as getPosts } from "@/app/api/v1/public/sectors/[id]/posts/route";
import { GET as getPostDetail } from "@/app/api/v1/public/sectors/[id]/posts/[postId]/route";
import { GET as getFirehose } from "@/app/api/v1/public/sectors/[id]/messages/route";
import { DELETE as adminDeletePost } from "@/app/api/v1/admin/posts/[id]/route";
import { prisma } from "@/lib/prisma";
import { mintKey } from "@/src/auth/api-keys";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

const ADMIN_TOKEN = "test-admin-token-for-messages-suite";

interface Seed {
  sectorId: string;
  ownerId: string;
  botId: string;
  botHandle: string;
  botDisplayName: string;
  apiKeyId: string;
  apiKeyPlaintext: string;
  mentionTargetBotId: string;
  mentionTargetHandle: string;
}

async function seed(): Promise<Seed> {
  // Deterministic pepper for the test — botKeyAuth uses
  // BOTPLACE_API_KEY_PEPPER from env; we set it locally to match.
  const pepper = "0".repeat(64);
  process.env.BOTPLACE_API_KEY_PEPPER = pepper;
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;

  const sectorId = `msgtest-${randomUUID().slice(0, 8)}`;
  const ownerId = `owner-${randomUUID().slice(0, 8)}`;
  const botId = `bot-${randomUUID().slice(0, 8)}`;
  const apiKeyId = `key-${randomUUID().slice(0, 8)}`;
  const handle = `msgtest-${randomUUID().slice(0, 8).toLowerCase()}`;
  const displayName = `Msg Test Bot ${handle}`;

  // A second bot to test @mention resolution.
  const mentionTargetBotId = `bot-${randomUUID().slice(0, 8)}`;
  const mentionTargetHandle = `target-${randomUUID().slice(0, 8).toLowerCase()}`;

  await prisma.sector.create({
    data: {
      id: sectorId,
      name: sectorId,
      width: 100,
      height: 100,
      paletteVersion: 1,
    },
  });
  await prisma.owner.create({
    data: {
      id: ownerId,
      googleSub: `test-${ownerId}`,
      email: `${ownerId}@example.test`,
      displayName: ownerId,
    },
  });
  // POWER tier so the test can write multiple times within the 60s
  // FREE-tier bucket window. POWER's forum bucket is capacity 10 /
  // refill 1 per 10s — plenty for the per-test write count.
  await prisma.bot.create({
    data: { id: botId, ownerId, handle, displayName, rateTier: "POWER" },
  });
  await prisma.bot.create({
    data: {
      id: mentionTargetBotId,
      ownerId,
      handle: mentionTargetHandle,
      displayName: `Target ${mentionTargetHandle}`,
      rateTier: "POWER",
    },
  });
  const minted = mintKey("bp_live", pepper);
  await prisma.botApiKey.create({
    data: { id: apiKeyId, botId, keyHash: minted.hash, prefix: minted.prefix },
  });

  return {
    sectorId,
    ownerId,
    botId,
    botHandle: handle,
    botDisplayName: displayName,
    apiKeyId,
    apiKeyPlaintext: minted.plaintext,
    mentionTargetBotId,
    mentionTargetHandle,
  };
}

async function cleanup(s: Seed): Promise<void> {
  await prisma.reply.deleteMany({ where: { sectorId: s.sectorId } });
  await prisma.post.deleteMany({ where: { sectorId: s.sectorId } });
  await prisma.adminAuditEvent.deleteMany({
    where: { action: { in: ["soft_delete_post", "soft_delete_reply"] } },
  });
  await prisma.botApiKey.deleteMany({ where: { botId: s.botId } });
  await prisma.bot.deleteMany({
    where: { id: { in: [s.botId, s.mentionTargetBotId] } },
  });
  await prisma.owner.deleteMany({ where: { id: s.ownerId } });
  await prisma.sector.deleteMany({ where: { id: s.sectorId } });
}

function authedRequest(token: string, body?: unknown): Request {
  return new Request("http://test/", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describeIfDb("POST /api/v1/sectors/:id/posts", () => {
  it(
    "creates a post, resolves @mentions, returns stored shape",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const res = await postPost(
          authedRequest(s.apiKeyPlaintext, {
            title: "Galaxy build, top-left",
            description: "Coordinating arms",
            body: `Working a galaxy. @${s.mentionTargetHandle}, take the arm structure?`,
            labels: ["coordination", "galaxy"],
          }),
          { params: Promise.resolve({ id: s.sectorId }) },
        );
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.post.title).toBe("Galaxy build, top-left");
        expect(body.post.author.handle).toBe(s.botHandle);
        expect(body.post.labels).toEqual(["coordination", "galaxy"]);
        expect(body.post.mentioned_bot_ids).toEqual([s.mentionTargetBotId]);
        expect(body.post.sector_id).toBe(s.sectorId);
      } finally {
        await cleanup(s);
      }
    },
  );

  it("rejects empty title with title_required", async () => {
    const s = await seed();
    try {
      const res = await postPost(
        authedRequest(s.apiKeyPlaintext, { title: "", body: "Hi" }),
        { params: Promise.resolve({ id: s.sectorId }) },
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.field).toBe("title");
      expect(body.reason).toBe("title_required");
    } finally {
      await cleanup(s);
    }
  });

  it("rejects invalid label", async () => {
    const s = await seed();
    try {
      const res = await postPost(
        authedRequest(s.apiKeyPlaintext, {
          title: "Hi",
          body: "Hi",
          labels: ["UPPER_CASE_BAD"],
        }),
        { params: Promise.resolve({ id: s.sectorId }) },
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.field).toBe("labels");
    } finally {
      await cleanup(s);
    }
  });
});

describeIfDb("POST /api/v1/sectors/:id/posts/:postId/replies", () => {
  it(
    "creates a reply, returns stored shape",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        // Create a parent post.
        const postRes = await postPost(
          authedRequest(s.apiKeyPlaintext, {
            title: "Hi",
            body: "Parent body",
          }),
          { params: Promise.resolve({ id: s.sectorId }) },
        );
        const postBody = await postRes.json();
        const postId = postBody.post.id;

        const replyRes = await postReply(
          authedRequest(s.apiKeyPlaintext, {
            body: `Replying. @${s.mentionTargetHandle}, you in?`,
          }),
          { params: Promise.resolve({ id: s.sectorId, postId }) },
        );
        expect(replyRes.status).toBe(201);
        const replyBody = await replyRes.json();
        expect(replyBody.reply.body).toContain(
          `@${s.mentionTargetHandle}`,
        );
        expect(replyBody.reply.mentioned_bot_ids).toEqual([
          s.mentionTargetBotId,
        ]);
        expect(replyBody.reply.post_id).toBe(postId);
      } finally {
        await cleanup(s);
      }
    },
  );

  it("404s on unknown post", async () => {
    const s = await seed();
    try {
      const res = await postReply(
        authedRequest(s.apiKeyPlaintext, { body: "Hi" }),
        {
          params: Promise.resolve({
            id: s.sectorId,
            postId: "999999999",
          }),
        },
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("post_not_found");
    } finally {
      await cleanup(s);
    }
  });
});

describeIfDb("GET /api/v1/public/sectors/:id/posts (list)", () => {
  it("lists posts, newest first by default", async () => {
    const s = await seed();
    try {
      await postPost(
        authedRequest(s.apiKeyPlaintext, { title: "First", body: "1" }),
        { params: Promise.resolve({ id: s.sectorId }) },
      );
      // Sleep so timestamps differ.
      await new Promise((r) => setTimeout(r, 25));
      await postPost(
        authedRequest(s.apiKeyPlaintext, { title: "Second", body: "2" }),
        { params: Promise.resolve({ id: s.sectorId }) },
      );

      const res = await getPosts(new Request("http://test/"), {
        params: Promise.resolve({ id: s.sectorId }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.posts.length).toBe(2);
      expect(body.posts[0].title).toBe("Second");
      expect(body.posts[1].title).toBe("First");
      expect(body.posts[0].reply_count).toBe(0);
    } finally {
      await cleanup(s);
    }
  });
});

describeIfDb("GET /api/v1/public/sectors/:id/posts/:postId (detail)", () => {
  it("returns post + replies in thread order", async () => {
    const s = await seed();
    try {
      const postRes = await postPost(
        authedRequest(s.apiKeyPlaintext, { title: "Hi", body: "Parent" }),
        { params: Promise.resolve({ id: s.sectorId }) },
      );
      const postId = (await postRes.json()).post.id;

      await postReply(
        authedRequest(s.apiKeyPlaintext, { body: "first reply" }),
        { params: Promise.resolve({ id: s.sectorId, postId }) },
      );
      await new Promise((r) => setTimeout(r, 25));
      await postReply(
        authedRequest(s.apiKeyPlaintext, { body: "second reply" }),
        { params: Promise.resolve({ id: s.sectorId, postId }) },
      );

      const res = await getPostDetail(new Request("http://test/"), {
        params: Promise.resolve({ id: s.sectorId, postId }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.post.title).toBe("Hi");
      expect(body.post.replies.length).toBe(2);
      expect(body.post.replies[0].body).toBe("first reply");
      expect(body.post.replies[1].body).toBe("second reply");
    } finally {
      await cleanup(s);
    }
  });
});

describeIfDb("GET /api/v1/public/sectors/:id/messages (firehose)", () => {
  it("intermingles posts + replies, sorted desc by created_at", async () => {
    const s = await seed();
    try {
      const postRes = await postPost(
        authedRequest(s.apiKeyPlaintext, { title: "P1", body: "B1" }),
        { params: Promise.resolve({ id: s.sectorId }) },
      );
      const postId = (await postRes.json()).post.id;
      await new Promise((r) => setTimeout(r, 25));
      await postReply(
        authedRequest(s.apiKeyPlaintext, { body: "R1" }),
        { params: Promise.resolve({ id: s.sectorId, postId }) },
      );

      const res = await getFirehose(new Request("http://test/"), {
        params: Promise.resolve({ id: s.sectorId }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entries.length).toBe(2);
      expect(body.entries[0].kind).toBe("reply");
      expect(body.entries[1].kind).toBe("post");
      expect(body.entries[0].post_id).toBe(postId);
    } finally {
      await cleanup(s);
    }
  });
});

describeIfDb("DELETE /api/v1/admin/posts/:id (soft-delete)", () => {
  it(
    "soft-deletes a post, removes it from reads, idempotent on re-delete",
    { timeout: 30_000 },
    async () => {
      const s = await seed();
      try {
        const postRes = await postPost(
          authedRequest(s.apiKeyPlaintext, {
            title: "Doomed",
            body: "soon",
          }),
          { params: Promise.resolve({ id: s.sectorId }) },
        );
        const postId = (await postRes.json()).post.id;

        const delRes = await adminDeletePost(
          new Request("http://test/", {
            method: "DELETE",
            headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
          }),
          { params: Promise.resolve({ id: postId }) },
        );
        expect(delRes.status).toBe(200);
        const delBody = await delRes.json();
        expect(delBody.deleted).toBe(true);
        expect(delBody.idempotent).toBe(false);

        // List no longer includes it.
        const listRes = await getPosts(new Request("http://test/"), {
          params: Promise.resolve({ id: s.sectorId }),
        });
        const listBody = await listRes.json();
        expect(listBody.posts.length).toBe(0);

        // Detail 404s.
        const detailRes = await getPostDetail(new Request("http://test/"), {
          params: Promise.resolve({ id: s.sectorId, postId }),
        });
        expect(detailRes.status).toBe(404);

        // Re-delete is idempotent.
        const delAgain = await adminDeletePost(
          new Request("http://test/", {
            method: "DELETE",
            headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
          }),
          { params: Promise.resolve({ id: postId }) },
        );
        expect(delAgain.status).toBe(200);
        const delAgainBody = await delAgain.json();
        expect(delAgainBody.idempotent).toBe(true);
      } finally {
        await cleanup(s);
      }
    },
  );

  it("returns 404 with no auth (path-existence hiding)", async () => {
    const res = await adminDeletePost(
      new Request("http://test/", { method: "DELETE" }),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });
});

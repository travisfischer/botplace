-- Bot message board — per-sector forum + threaded replies.
--
-- Adds two new tables:
--   posts    — forum-shaped parent posts (title, description, body, labels)
--   replies  — single-level-deep threaded replies under a post (body only)
--
-- Both:
--   * append-only after creation (no bot edits; admin soft-delete only)
--   * authored by a Bot (via a specific BotApiKey, captured at write-time)
--   * scoped to a Sector (sectors will eventually have separate boards)
--   * carry resolved @mention metadata in `mentioned_bot_ids`
--   * persist past bot lifecycle — Restrict-on-delete on every FK
--
-- See requirement-20260520-1441-bot-message-board.md for the design.

-- ----------------------------------------------------------------------
-- posts
-- ----------------------------------------------------------------------

CREATE TABLE "posts" (
    "id" BIGSERIAL NOT NULL,
    "sector_id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "body" TEXT NOT NULL,
    "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "mentioned_bot_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- Hot read: list posts per sector by recency (default sort).
CREATE INDEX "posts_sector_id_created_at_idx"
    ON "posts" ("sector_id", "created_at" DESC);

-- Firehose: union with replies, sorted globally by created_at.
CREATE INDEX "posts_created_at_idx" ON "posts" ("created_at");

-- Label filter (future). GIN over text[] supports `@>`, `<@`, `&&`.
-- Prisma 5/6/7 does emit `USING GIN` for `@@index([labels], type: Gin)`
-- but we declare it explicitly here so future migrations off this base
-- diff cleanly without relying on Prisma's emit format.
CREATE INDEX "posts_labels_idx" ON "posts" USING GIN ("labels");

ALTER TABLE "posts" ADD CONSTRAINT "posts_sector_id_fkey"
    FOREIGN KEY ("sector_id") REFERENCES "sectors"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "posts" ADD CONSTRAINT "posts_bot_id_fkey"
    FOREIGN KEY ("bot_id") REFERENCES "bots"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "posts" ADD CONSTRAINT "posts_api_key_id_fkey"
    FOREIGN KEY ("api_key_id") REFERENCES "bot_api_keys"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------------------
-- replies
-- ----------------------------------------------------------------------
-- One level of nesting only — Reply has no parent_reply_id, so a
-- deeper tree is structurally impossible.

CREATE TABLE "replies" (
    "id" BIGSERIAL NOT NULL,
    "post_id" BIGINT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentioned_bot_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "replies_pkey" PRIMARY KEY ("id")
);

-- Hot read: replies for a post, oldest-first (thread order).
CREATE INDEX "replies_post_id_created_at_idx"
    ON "replies" ("post_id", "created_at");

-- Firehose: union with posts, sorted by created_at. `sector_id` is
-- denormalized onto Reply so the union doesn't need a JOIN to filter
-- by sector. Same value as the parent Post's sector_id.
CREATE INDEX "replies_sector_id_created_at_idx"
    ON "replies" ("sector_id", "created_at");

ALTER TABLE "replies" ADD CONSTRAINT "replies_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "posts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "replies" ADD CONSTRAINT "replies_sector_id_fkey"
    FOREIGN KEY ("sector_id") REFERENCES "sectors"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "replies" ADD CONSTRAINT "replies_bot_id_fkey"
    FOREIGN KEY ("bot_id") REFERENCES "bots"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "replies" ADD CONSTRAINT "replies_api_key_id_fkey"
    FOREIGN KEY ("api_key_id") REFERENCES "bot_api_keys"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

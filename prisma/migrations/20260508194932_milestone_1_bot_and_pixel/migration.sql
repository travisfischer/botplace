-- CreateEnum
CREATE TYPE "BotStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "owners" (
    "id" TEXT NOT NULL,
    "google_sub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_personal_access_tokens" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "owner_personal_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bots" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "BotStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_api_keys" (
    "id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "bot_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sectors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "palette_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sector_chunks" (
    "sector_id" TEXT NOT NULL,
    "chunk_x" INTEGER NOT NULL,
    "chunk_y" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sector_chunks_pkey" PRIMARY KEY ("sector_id","chunk_x","chunk_y")
);

-- CreateTable
CREATE TABLE "pixel_events" (
    "id" BIGSERIAL NOT NULL,
    "request_id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "color" INTEGER NOT NULL,
    "palette_version" INTEGER NOT NULL,
    "bot_id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "chunk_version_after" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pixel_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_events" (
    "id" BIGSERIAL NOT NULL,
    "request_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_id" TEXT,
    "payload_json" JSONB NOT NULL,
    "source_ip" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "owners_google_sub_key" ON "owners"("google_sub");

-- CreateIndex
CREATE UNIQUE INDEX "owner_personal_access_tokens_token_hash_key" ON "owner_personal_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "owner_personal_access_tokens_owner_id_idx" ON "owner_personal_access_tokens"("owner_id");

-- CreateIndex
CREATE INDEX "bots_owner_id_idx" ON "bots"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "bots_owner_id_name_key" ON "bots"("owner_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "bot_api_keys_key_hash_key" ON "bot_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "bot_api_keys_bot_id_idx" ON "bot_api_keys"("bot_id");

-- CreateIndex
CREATE INDEX "pixel_events_sector_id_id_idx" ON "pixel_events"("sector_id", "id");

-- CreateIndex
CREATE INDEX "pixel_events_sector_id_created_at_idx" ON "pixel_events"("sector_id", "created_at");

-- CreateIndex
CREATE INDEX "pixel_events_bot_id_created_at_idx" ON "pixel_events"("bot_id", "created_at");

-- CreateIndex
CREATE INDEX "pixel_events_api_key_id_idx" ON "pixel_events"("api_key_id");

-- CreateIndex
CREATE INDEX "admin_audit_events_action_created_at_idx" ON "admin_audit_events"("action", "created_at");

-- AddForeignKey
ALTER TABLE "owner_personal_access_tokens" ADD CONSTRAINT "owner_personal_access_tokens_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bots" ADD CONSTRAINT "bots_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_api_keys" ADD CONSTRAINT "bot_api_keys_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sector_chunks" ADD CONSTRAINT "sector_chunks_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pixel_events" ADD CONSTRAINT "pixel_events_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pixel_events" ADD CONSTRAINT "pixel_events_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pixel_events" ADD CONSTRAINT "pixel_events_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "bot_api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

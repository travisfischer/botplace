-- Bot description field — first post-MVP feature.
--
-- Adds two nullable columns to `bots`:
--   description            — self-declared bio, ≤ MAX_DESCRIPTION_LENGTH
--                            UTF-16 code units, stored post-moderation
--                            (URLs redacted, deny-list matches rejected
--                            at write time).
--   description_updated_at — bumps on every description write.
--
-- Both are nullable. Existing rows get NULL (no backfill). No new
-- indexes — the field is not queried as a filter, only selected.

ALTER TABLE "bots" ADD COLUMN "description" TEXT;
ALTER TABLE "bots" ADD COLUMN "description_updated_at" TIMESTAMP(3);

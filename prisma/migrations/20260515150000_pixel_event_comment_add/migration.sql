-- Bot pixel comments — second post-MVP feature.
--
-- Adds one nullable column to `pixel_events`:
--   comment — optional bot-supplied commentary on this specific pixel
--             write. ≤ MAX_COMMENT_LENGTH (128) UTF-16 code units,
--             stored post-moderation (URLs redacted to `[link]`;
--             deny-list matches replace the whole comment with the
--             literal `[redacted]`). Immutable — re-writing the pixel
--             produces a new PixelEvent with its own comment.
--
-- Nullable + additive. Existing rows get NULL (no backfill). No new
-- index — comments are selected per-row by the read endpoints, never
-- used as a filter or join key.

ALTER TABLE "pixel_events" ADD COLUMN "comment" TEXT;

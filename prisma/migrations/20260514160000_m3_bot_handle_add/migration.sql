-- M3 Theme B: identity migration, step 1 of 2.
--
-- Adds the new identity columns (`handle` globally-unique slug,
-- `display_name` per-owner-unique label), backfills them from the
-- legacy `name` column, then enforces NOT NULL and the new indexes.
--
-- The legacy `name` column is intentionally NOT dropped here. Step 2
-- (20260514160100_m3_drop_bot_name) drops it once the code that still
-- reads `name` has been removed and a probe has confirmed the new
-- columns are populated correctly. This split exists so an operator
-- can pause between migrations in production (per requirement R1).

-- Add nullable so the backfill below doesn't violate NOT NULL.
ALTER TABLE "bots" ADD COLUMN "handle" TEXT;
ALTER TABLE "bots" ADD COLUMN "display_name" TEXT;

-- Backfill: copy `name` into both new columns. Two cases:
--   1. M2.5 launch bots ("m25-conway", "m25-sparkle", "m25-visitor-pulse")
--      already match the handle regex. Direct copy is safe.
--   2. Any other dev/test bots — their existing `name` is per-owner
--      unique, but the new `handle` is GLOBAL unique. If two owners
--      already happen to share a name, the unique index below will
--      fail and the migration aborts. The operator then resolves the
--      collision by hand (rename one bot via UPDATE) and re-runs.
--      In production, only the three M25 launch bots exist as of M3
--      planning, so this case shouldn't fire.
UPDATE "bots" SET "handle" = "name", "display_name" = "name" WHERE "handle" IS NULL;

-- Now NOT NULL.
ALTER TABLE "bots" ALTER COLUMN "handle" SET NOT NULL;
ALTER TABLE "bots" ALTER COLUMN "display_name" SET NOT NULL;

-- Drop the old (owner_id, name) uniqueness — it's superseded by
-- (owner_id, display_name) below.
DROP INDEX "bots_owner_id_name_key";

-- New indexes match the M3 schema.
CREATE UNIQUE INDEX "bots_handle_key" ON "bots"("handle");
CREATE UNIQUE INDEX "bots_owner_id_display_name_key" ON "bots"("owner_id", "display_name");

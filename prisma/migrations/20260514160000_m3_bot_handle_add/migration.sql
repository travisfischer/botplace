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

-- Preflight: refuse to migrate if any two bots share a name across
-- owners. The legacy `name` column is per-owner unique (`bots_owner_id_name_key`),
-- but the new `handle` column is GLOBAL unique. A naive backfill would
-- silently fail at the `bots_handle_key` step below, leaving the
-- schema half-migrated. Detect collisions FIRST so the operator gets
-- a clear actionable error instead of debugging a half-applied state.
--
-- In production as of M3 planning only the three M25 launch bots
-- exist, so this should be a no-op. The block is defense-in-depth
-- for any future redeploy against a populated dev/staging branch.
DO $$
DECLARE
  collisions INTEGER;
BEGIN
  SELECT COUNT(*) INTO collisions FROM (
    SELECT name FROM "bots" GROUP BY name HAVING COUNT(*) > 1
  ) AS dupes;
  IF collisions > 0 THEN
    RAISE EXCEPTION
      'M3 handle migration aborted: % bot name(s) collide across owners. '
      'Resolve manually before re-running. '
      'List with: SELECT name, array_agg(id) FROM bots GROUP BY name HAVING COUNT(*) > 1;',
      collisions;
  END IF;
END $$;

-- Add nullable so the backfill below doesn't violate NOT NULL.
ALTER TABLE "bots" ADD COLUMN "handle" TEXT;
ALTER TABLE "bots" ADD COLUMN "display_name" TEXT;

-- Backfill: copy `name` into both new columns. The preflight above
-- guarantees no global-uniqueness collision will fire on the
-- bots_handle_key index added below.
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

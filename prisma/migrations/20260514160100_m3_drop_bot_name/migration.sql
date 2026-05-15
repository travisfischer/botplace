-- M3 Theme B: identity migration, step 2 of 2.
--
-- Drops the legacy `name` column. Step 1
-- (20260514160000_m3_bot_handle_add) added `handle` and `display_name`,
-- backfilled them from `name`, and added the new unique indexes. All
-- application code (route handlers, the launch-bot cron routes, the
-- viewer, scripts) has been updated to read from the new columns.
--
-- Drop is irreversible. The split from step 1 exists so an operator
-- can pause between migrations in production: apply step 1, run the
-- M3 probe to confirm the new columns are populated end-to-end, then
-- apply step 2.

ALTER TABLE "bots" DROP COLUMN "name";

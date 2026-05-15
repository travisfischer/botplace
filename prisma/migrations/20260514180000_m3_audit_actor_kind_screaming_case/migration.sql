-- M3 Theme C cleanup (P2.3 from the multi-reviewer synthesis).
--
-- Rename `AuditActorKind` enum values to SCREAMING_CASE so they match
-- the existing repo convention shared by `BotStatus`
-- (`ACTIVE`/`REVOKED`) and `BotRateTier` (`FREE`/`POWER`). The
-- original M3 migration (20260514160200_m3_audit_actor_kind) shipped
-- snake_case values, which the multi-reviewer synthesis flagged as
-- schema-convention drift.
--
-- This rename lands BEFORE any production audit row exists with the
-- snake_case spelling — every pre-M3 audit row was backfilled to
-- `admin_token` by the original migration's column default, but no
-- M3 code has yet run in production. Catching the convention drift
-- now costs nothing; catching it post-prod-deploy would require a
-- table rewrite.

ALTER TYPE "AuditActorKind" RENAME VALUE 'admin_token' TO 'ADMIN_TOKEN';
ALTER TYPE "AuditActorKind" RENAME VALUE 'seed_script' TO 'SEED_SCRIPT';
ALTER TYPE "AuditActorKind" RENAME VALUE 'owner' TO 'OWNER';

-- Re-pin the column default explicitly. ALTER TYPE RENAME VALUE
-- preserves the underlying OID so existing rows + the column default
-- automatically pick up the new spelling, but being explicit here
-- guards against any future reader who assumes otherwise.
ALTER TABLE "admin_audit_events"
  ALTER COLUMN "actor_kind" SET DEFAULT 'ADMIN_TOKEN';

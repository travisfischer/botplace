-- M3 Theme C: normalize the AdminAuditEvent actor surface.
--
-- Pre-M3, "who took the action" was buried inside `payload_json` via
-- an ad-hoc `actor` field. M3 promotes the actor TYPE to a top-level
-- enum column so audit queries by source (admin-token vs. operator
-- script vs. owner mutation) don't require JSON parsing.
--
-- Every pre-M3 row came through the ADMIN_TOKEN-gated admin routes
-- (revoke-key, set-bot-tier), so the backfill default is `admin_token`.
-- New rows written by owner-initiated mutations and operator scripts
-- set their own value at insert time.

CREATE TYPE "AuditActorKind" AS ENUM ('admin_token', 'seed_script', 'owner');

-- Column is NOT NULL with a default of admin_token so the default
-- backfills existing rows and future inserts that forget to specify
-- still produce a sane value.
ALTER TABLE "admin_audit_events"
  ADD COLUMN "actor_kind" "AuditActorKind" NOT NULL DEFAULT 'admin_token';

-- Index supports "list audit events for actor type X" queries.
CREATE INDEX "admin_audit_events_actor_kind_created_at_idx"
  ON "admin_audit_events"("actor_kind", "created_at");

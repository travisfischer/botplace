-- M1 polish (T4): index cleanup against database-conventions.md.
--
-- 1. Drop redundant index on bots(owner_id) — `bots_owner_id_name_key`
--    serves the same prefix scan via leftmost-prefix matching.
-- 2. Replace bot_api_keys(bot_id) with (bot_id, revoked_at) so the hot
--    "active keys for this bot" filter rides the index.
-- 3. Replace owner_personal_access_tokens(owner_id) with
--    (owner_id, revoked_at) for the same reason on the PAT side.

-- Drop the redundant Bot.ownerId index.
DROP INDEX IF EXISTS "bots_owner_id_idx";

-- Recreate BotApiKey's index as a compound that includes revoked_at.
DROP INDEX IF EXISTS "bot_api_keys_bot_id_idx";
CREATE INDEX "bot_api_keys_bot_id_revoked_at_idx" ON "bot_api_keys"("bot_id", "revoked_at");

-- Same treatment for OwnerPersonalAccessToken.
DROP INDEX IF EXISTS "owner_personal_access_tokens_owner_id_idx";
CREATE INDEX "owner_personal_access_tokens_owner_id_revoked_at_idx" ON "owner_personal_access_tokens"("owner_id", "revoked_at");

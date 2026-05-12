#!/usr/bin/env node
// scripts/m2.5/seed-launch-bots.mjs
//
// Provision the M2.5 launch bots under a real owner record. Looks up
// the owner by email, then creates three POWER-tier bots if they don't
// already exist:
//
//   m25-visitor-pulse  — top-row viewer meter
//   m25-sparkle        — radial halo on the most recent non-self write
//   m25-conway         — Game of Life on chunk-of-the-minute
//
// Idempotent on (owner_id, bot_name). Re-running is safe:
//   - Bot doesn't exist for that owner → create it, mint a key, print
//     the plaintext API key ONCE.
//   - Bot already exists → skip silently with "already provisioned"
//     and the bot_id (key rotation is an explicit separate action).
//
// Usage:
//   # Local dev (pepper + DATABASE_URL come from .env):
//   pnpm op m25:seed-launch-bots --owner-email travis@folkforest.com
//
//   # Production seeding (pepper + DATABASE_URL come from Vercel env):
//   vercel env pull --environment=production /tmp/m25-prod-env
//   set -a; source /tmp/m25-prod-env; set +a
//   pnpm m25:seed-launch-bots --owner-email travis@folkforest.com
//
// Reads BOTPLACE_API_KEY_PEPPER + DATABASE_URL from .env (loaded via
// dotenv/config below) OR from process env when those are already set
// — see `docs/dev/probes/m2.5-launch-bots.md` for the prod path. The
// owner email is supplied as a script argument so the script has no
// hardcoded identity.
//
// Cleanup: delete the bot rows manually (and their api_keys + any
// pixel_events they wrote) if you want to re-mint. Or use
// `pnpm admin:set-bot-tier <bot_id> FREE` to demote them.

import "dotenv/config";
import { createHmac, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import pg from "pg";
const { Client } = pg;

const PEPPER = process.env.BOTPLACE_API_KEY_PEPPER;
const DB_URL = process.env.DATABASE_URL;

if (!PEPPER || PEPPER.length < 64) {
  console.error(
    "ERROR: BOTPLACE_API_KEY_PEPPER missing or too short (need ≥ 64 chars).\n" +
      "  For local dev: pnpm op db:bootstrap   (generates a disposable per-branch pepper)\n" +
      "  For prod seed: vercel env pull --environment=production /tmp/m25-prod-env\n" +
      "                 set -a; source /tmp/m25-prod-env; set +a\n" +
      "  Never reuse the dev pepper for prod — keys hashed with the wrong pepper\n" +
      "  silently fail auth.",
  );
  process.exit(2);
}
if (!DB_URL) {
  console.error(
    "ERROR: DATABASE_URL missing.\n" +
      "  For local dev: pnpm op db:bootstrap\n" +
      "  For prod seed: vercel env pull --environment=production /tmp/m25-prod-env\n" +
      "                 set -a; source /tmp/m25-prod-env; set +a",
  );
  process.exit(2);
}

const { values } = parseArgs({
  options: {
    "owner-email": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help || !values["owner-email"]) {
  console.error(
    "usage: pnpm m25:seed-launch-bots --owner-email <email>\n" +
      "  (or `pnpm op m25:seed-launch-bots ...` for local dev with op-wrapper)\n" +
      "  Creates m25-visitor-pulse, m25-sparkle, m25-conway under the owner\n" +
      "  with the given email (must already exist in the owners table).\n" +
      "  Idempotent: skips bots that already exist.",
  );
  process.exit(values.help ? 0 : 2);
}

const OWNER_EMAIL = values["owner-email"];

// Force sslmode=verify-full to match lib/prisma.ts.
const url = (() => {
  try {
    const u = new URL(DB_URL);
    u.searchParams.set("sslmode", "verify-full");
    return u.toString();
  } catch {
    return DB_URL;
  }
})();

const BOT_NAMES = ["m25-visitor-pulse", "m25-sparkle", "m25-conway"];

function generateApiKey() {
  const random = randomBytes(32).toString("base64url");
  const plaintext = `bp_live_${random}`;
  const hash = createHmac("sha256", PEPPER).update(plaintext).digest("hex");
  const prefix = `bp_live_${random.slice(0, 8)}`;
  return { plaintext, hash, prefix };
}

function cuid() {
  // Match the shape Prisma's @default(cuid()) emits well enough for
  // hand-inserted rows. Real CUIDs are time-sortable but the format
  // doesn't matter to anything we care about here — uniqueness is the
  // only invariant, and randomBytes(12) gives us plenty.
  return "c" + randomBytes(12).toString("base64url").slice(0, 24);
}

const client = new Client({ connectionString: url });

try {
  await client.connect();

  // 1. Find the owner.
  const ownerRows = await client.query(
    "SELECT id, display_name, email FROM owners WHERE email = $1",
    [OWNER_EMAIL],
  );
  if (ownerRows.rowCount === 0) {
    console.error(
      `ERROR: no owner with email ${OWNER_EMAIL} in this database.`,
    );
    process.exit(1);
  }
  if (ownerRows.rowCount > 1) {
    console.error(
      `ERROR: ${ownerRows.rowCount} owners with email ${OWNER_EMAIL}. ` +
        "Disambiguate before re-running.",
    );
    process.exit(1);
  }
  const owner = ownerRows.rows[0];
  console.error(
    `Provisioning M2.5 bots under owner ${owner.id} (${owner.display_name}, ${owner.email})`,
  );

  const results = [];

  for (const name of BOT_NAMES) {
    // 2a. Check if bot already exists for this owner.
    const existingRows = await client.query(
      "SELECT id, rate_tier FROM bots WHERE owner_id = $1 AND name = $2",
      [owner.id, name],
    );
    if (existingRows.rowCount > 0) {
      const existing = existingRows.rows[0];
      results.push({
        bot_name: name,
        bot_id: existing.id,
        rate_tier: existing.rate_tier,
        provisioned: "existed",
      });
      console.error(
        `  already provisioned: ${name} (id=${existing.id}, tier=${existing.rate_tier})`,
      );
      continue;
    }

    // 2b. Create the bot + API key in one transaction.
    const botId = cuid();
    const keyId = cuid();
    const key = generateApiKey();

    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO bots (id, owner_id, name, status, rate_tier, created_at)
         VALUES ($1, $2, $3, 'ACTIVE', 'POWER', now())`,
        [botId, owner.id, name],
      );
      await client.query(
        `INSERT INTO bot_api_keys (id, bot_id, key_hash, prefix, created_at)
         VALUES ($1, $2, $3, $4, now())`,
        [keyId, botId, key.hash, key.prefix],
      );
      // Audit trail so the provisioning shows up in the standard
      // operator log surface (same shape as set-bot-tier).
      await client.query(
        `INSERT INTO admin_audit_events
           (request_id, action, target_id, payload_json, source_ip, created_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [
          cuid(),
          "set_bot_rate_tier",
          botId,
          JSON.stringify({
            before: { rate_tier: "FREE" },
            after: { rate_tier: "POWER" },
            bot_name: name,
            owner_id: owner.id,
            provisioned_by: "m2.5-seed-launch-bots",
            idempotent: false,
          }),
          "local-script",
        ],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }

    results.push({
      bot_name: name,
      bot_id: botId,
      api_key_id: keyId,
      api_key: key.plaintext,
      api_key_prefix: key.prefix,
      rate_tier: "POWER",
      provisioned: "created",
    });
    console.error(`  created: ${name} (id=${botId}, key prefix=${key.prefix})`);
  }

  console.log(JSON.stringify(results, null, 2));
} catch (err) {
  console.error("seed-launch-bots failed:", err.message || err);
  process.exit(1);
} finally {
  await client.end();
}

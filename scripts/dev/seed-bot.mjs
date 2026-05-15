#!/usr/bin/env node
// scripts/dev/seed-bot.mjs
//
// Mint a test bot + API key directly against the database. Bypasses
// Google OAuth (which requires the OAuth client to have localhost
// registered) so you can write pixels against your local dev branch
// immediately after `pnpm op db:bootstrap`.
//
// Reads BOTPLACE_API_KEY_PEPPER + DATABASE_URL from process env (both
// already in .env after bootstrap, loaded by `dotenv/config` here).
//
// Usage:
//   pnpm dev:seed-bot                     creates dev-owner-* / dev-bot-*
//   pnpm dev:seed-bot --handle foo        same but with a specific handle
//   pnpm dev:seed-bot --bot-name foo      back-compat alias for --handle
//
// Output: JSON to stdout with bot_id, key_id, plaintext API key. The
// key is shown ONCE. Save it to a shell var, then use curl to write
// pixels (see the dev probe in docs/dev/probes/m2-viewer.md § Probe 1
// for shape).
//
// The dev-owner row uses a synthetic googleSub of `dev-<id>` so it
// never collides with a real Google sign-in. To clean up, just delete
// your Neon dev branch (`pnpm op db:branch:cleanup --yes`).

import "dotenv/config";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
const { Client } = pg;

const PEPPER = process.env.BOTPLACE_API_KEY_PEPPER;
const DB_URL = process.env.DATABASE_URL;

if (!PEPPER || PEPPER.length < 64) {
  console.error(
    "ERROR: BOTPLACE_API_KEY_PEPPER missing or too short. Run `pnpm op db:bootstrap` first.",
  );
  process.exit(2);
}
if (!DB_URL) {
  console.error("ERROR: DATABASE_URL missing. Run `pnpm op db:bootstrap` first.");
  process.exit(2);
}

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

const args = process.argv.slice(2);
// `--bot-name` accepted as a back-compat alias for `--handle` (the M3
// canonical flag). New scripts should use `--handle`.
const handleArg = (() => {
  const i = args.indexOf("--handle");
  if (i >= 0 && args[i + 1]) return args[i + 1];
  const j = args.indexOf("--bot-name");
  if (j >= 0 && args[j + 1]) return args[j + 1];
  return null;
})();
// Generated handle: lowercase letters + hyphens + 6 hex chars. Matches
// the M3 handle regex (^[a-z][a-z0-9-]{2,31}$).
const handle = handleArg ?? `dev-bot-${randomUUID().slice(0, 6).toLowerCase()}`;
const displayName = handle;

const ownerId = `dev-owner-${randomUUID().slice(0, 8)}`;
const botId = `dev-bot-${randomUUID().slice(0, 8)}`;
const keyId = `dev-key-${randomUUID().slice(0, 8)}`;

const random = randomBytes(32).toString("base64url");
const plaintext = `bp_live_${random}`;
const hash = createHmac("sha256", PEPPER).update(plaintext).digest("hex");
const prefix = `bp_live_${random.slice(0, 8)}`;

const client = new Client({ connectionString: url });

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO owners (id, google_sub, email, display_name, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [ownerId, `dev-${ownerId}`, `${ownerId}@dev.local`, "Dev Owner"],
  );
  await client.query(
    `INSERT INTO bots (id, owner_id, handle, display_name, status, created_at)
     VALUES ($1, $2, $3, $4, 'ACTIVE', now())`,
    [botId, ownerId, handle, displayName],
  );
  await client.query(
    `INSERT INTO bot_api_keys (id, bot_id, key_hash, prefix, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [keyId, botId, hash, prefix],
  );
  await client.query("COMMIT");

  console.log(
    JSON.stringify(
      {
        owner_id: ownerId,
        bot_id: botId,
        bot_handle: handle,
        bot_display_name: displayName,
        key_id: keyId,
        api_key: plaintext,
        api_key_prefix: prefix,
      },
      null,
      2,
    ),
  );
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("seed-bot failed:", err.message || err);
  process.exit(1);
} finally {
  await client.end();
}

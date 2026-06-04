// scripts/admin/admin-accounts.mjs
//
// Operator CLIs for the admin-account flag (`Owner.isAdmin`):
//   pnpm admin:grant        --email <e> | --owner-id <id>
//   pnpm admin:revoke-admin --email <e> | --owner-id <id>
//   pnpm admin:list-admins
//
// Direct-DB via `pg` (see _common.mjs). Grant/revoke are operator
// (bootstrap-level) actions — audited as `SEED_SCRIPT`, since the first
// admin can't require a pre-existing admin actor. The exported
// functions take an injected client and are tested in
// tests/admin/admin-accounts.test.ts.

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { flagValue, makeClient, resolveOwner, writeAudit } from "./_common.mjs";

/**
 * Best-effort resolve of the operator who ran grant/revoke, for audit
 * attribution. Not gated (DB access is the real boundary; bootstrap of
 * the first admin can't require a pre-existing admin). Records whatever
 * is given; null id if unresolvable.
 * @param {import('pg').Client} client
 * @param {{ actorOwnerId?: string, actorEmail?: string }} opts
 */
async function resolveActor(client, { actorOwnerId, actorEmail }) {
  if (!actorOwnerId && !actorEmail) return { id: null, email: null };
  try {
    const o = await resolveOwner(client, { ownerId: actorOwnerId, email: actorEmail });
    return { id: o.id, email: o.email };
  } catch {
    return { id: null, email: actorEmail ?? null };
  }
}

/**
 * @param {import('pg').Client} client
 * @param {{ ownerId?: string, email?: string, actorOwnerId?: string, actorEmail?: string, requestId?: string, sourceIp?: string }} [opts]
 */
export async function grantAdmin(
  client,
  { ownerId, email, actorOwnerId, actorEmail, requestId = randomUUID(), sourceIp = "cli" } = {},
) {
  const owner = await resolveOwner(client, { ownerId, email });
  const alreadyAdmin = owner.isAdmin === true;
  await client.query("UPDATE owners SET is_admin = true WHERE id = $1", [owner.id]);
  const actor = await resolveActor(client, { actorOwnerId, actorEmail });
  await writeAudit(client, {
    requestId,
    action: "grant_admin",
    actorKind: "SEED_SCRIPT",
    targetId: owner.id,
    payload: {
      email: owner.email,
      already_admin: alreadyAdmin,
      actor_owner_id: actor.id,
      actor_email: actor.email,
    },
    sourceIp,
  });
  return { ownerId: owner.id, email: owner.email, alreadyAdmin };
}

/**
 * @param {import('pg').Client} client
 * @param {{ ownerId?: string, email?: string, actorOwnerId?: string, actorEmail?: string, requestId?: string, sourceIp?: string }} [opts]
 */
export async function revokeAdmin(
  client,
  { ownerId, email, actorOwnerId, actorEmail, requestId = randomUUID(), sourceIp = "cli" } = {},
) {
  const owner = await resolveOwner(client, { ownerId, email });
  const wasAdmin = owner.isAdmin === true;
  await client.query("UPDATE owners SET is_admin = false WHERE id = $1", [owner.id]);
  const actor = await resolveActor(client, { actorOwnerId, actorEmail });
  await writeAudit(client, {
    requestId,
    action: "revoke_admin",
    actorKind: "SEED_SCRIPT",
    targetId: owner.id,
    payload: {
      email: owner.email,
      was_admin: wasAdmin,
      actor_owner_id: actor.id,
      actor_email: actor.email,
    },
    sourceIp,
  });
  return { ownerId: owner.id, email: owner.email, wasAdmin };
}

export async function listAdmins(client) {
  const r = await client.query(
    "SELECT id, email FROM owners WHERE is_admin = true ORDER BY email",
  );
  return r.rows.map((row) => ({ id: row.id, email: row.email }));
}

const USAGE = `Usage:
  node scripts/admin/admin-accounts.mjs grant  (--email <e> | --owner-id <id>) [--actor <email>]
  node scripts/admin/admin-accounts.mjs revoke (--email <e> | --owner-id <id>) [--actor <email>]
  node scripts/admin/admin-accounts.mjs list

  --actor records WHO ran the grant/revoke in the audit row (optional;
  attribution only — DB access is the trust boundary).`;

async function main() {
  await import("dotenv/config");
  const args = process.argv.slice(2);
  const sub = args[0];
  const email = flagValue(args, "--email");
  const ownerId = flagValue(args, "--owner-id");
  const actorEmail = flagValue(args, "--actor");
  const actorOwnerId = flagValue(args, "--actor-id");

  if (!["grant", "revoke", "list"].includes(sub)) {
    console.error(USAGE);
    process.exit(2);
  }

  const client = makeClient(process.env.DATABASE_URL);
  await client.connect();
  try {
    if (sub === "grant") {
      const r = await grantAdmin(client, { email, ownerId, actorEmail, actorOwnerId });
      console.log(JSON.stringify({ granted: true, ...r }, null, 2));
    } else if (sub === "revoke") {
      const r = await revokeAdmin(client, { email, ownerId, actorEmail, actorOwnerId });
      console.log(JSON.stringify({ revoked: true, ...r }, null, 2));
    } else {
      const admins = await listAdmins(client);
      console.log(JSON.stringify({ admins }, null, 2));
    }
  } catch (err) {
    const code = err?.code ? `[${err.code}] ` : "";
    console.error(`admin-accounts ${sub} failed: ${code}${err?.message ?? err}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

// scripts/admin/_common.mjs
//
// Shared helpers for the admin operator CLIs (grant/revoke/list-admins
// and the sector reset commands). Direct-DB via `pg`, mirroring the
// connection + SSL convention in scripts/dev/seed-bot.mjs. Functions
// take an injected `pg` client so they're unit-testable against a dev
// branch (see tests/admin/*).
//
// Deliberate no-HTTP exemption: docs/design/principles.md makes HTTP
// endpoints the unit of operator capability, but the sector resets are
// intentionally CLI-and-direct-DB-only — an HTTP surface would widen the
// blast radius of the most destructive, irreversible operation in the
// system. This deviation is recorded in
// plans/requirements/requirement-20260603-1109-admin-sector-reset-clis.md.
// Note: `--actor` is operator-ASSERTED attribution for the audit trail,
// not authentication — `DATABASE_URL` access is the real trust boundary.

import { createInterface } from "node:readline/promises";

import pg from "pg";

const { Client } = pg;

/** Look up `--flag value` in an argv slice; undefined if absent. */
export function flagValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * Interactive guard for destructive CLIs: prompt the operator to retype
 * the sector id. Returns true only on an exact match. The `--yes` flag
 * in the caller skips this entirely.
 * @param {string} expected
 * @param {{ input?: import('node:stream').Readable, output?: import('node:stream').Writable }} [opts]
 * @returns {Promise<boolean>}
 */
export async function confirmRetype(expected, { input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      `\nType the sector id "${expected}" to confirm (anything else aborts): `,
    );
    return answer.trim() === expected;
  } finally {
    rl.close();
  }
}

/**
 * Normalize `sslmode` to `verify-full`, mirroring `normalizeSslMode` in
 * lib/prisma.ts. An explicit `sslmode=disable` is respected so non-TLS
 * hosts (CI's postgres:16-alpine, local Docker) work — production /
 * preview URLs never set `disable`. (The earlier version dropped this
 * opt-out, which red-failed CI — see tests/admin/common.test.ts.)
 */
export function dbUrlWithSsl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.searchParams.get("sslmode") === "disable") return u.toString();
    u.searchParams.set("sslmode", "verify-full");
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/** Build a (not-yet-connected) pg Client from a connection string. */
export function makeClient(rawUrl) {
  if (!rawUrl) throw new Error("DATABASE_URL missing");
  return new Client({ connectionString: dbUrlWithSsl(rawUrl) });
}

/**
 * Human label for the DB a destructive CLI is about to mutate, for the
 * confirmation warning. Prefers NEON_BRANCH_NAME (set on dev branches);
 * falls back to the DATABASE_URL host — important because in a Pattern-2
 * PROD shell NEON_BRANCH_NAME is unset, so the branch-name guardrail
 * would otherwise read "(unknown)".
 * @param {string|undefined} rawUrl
 * @param {string|undefined} [branch]
 */
export function dbTargetLabel(rawUrl, branch = process.env.NEON_BRANCH_NAME) {
  if (branch) return `branch "${branch}"`;
  try {
    return `host "${new URL(rawUrl).host}"`;
  } catch {
    return "(unknown target)";
  }
}

export class OwnerLookupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OwnerLookupError";
    this.code = code;
  }
}

/**
 * Resolve an owner by id (preferred) or email. `email` is NOT unique on
 * `owners`, so >1 match throws `owner_ambiguous` (caller should re-run
 * with --owner-id). 0 matches throws `owner_not_found`.
 */
/**
 * @param {import('pg').Client} client
 * @param {{ ownerId?: string, email?: string }} [opts]
 * @returns {Promise<{ id: string, email: string, isAdmin: boolean }>}
 */
export async function resolveOwner(client, { ownerId, email } = {}) {
  if (ownerId) {
    const r = await client.query(
      "SELECT id, email, is_admin FROM owners WHERE id = $1",
      [ownerId],
    );
    if (r.rows.length === 0) {
      throw new OwnerLookupError("owner_not_found", `No owner with id ${ownerId}`);
    }
    return { id: r.rows[0].id, email: r.rows[0].email, isAdmin: r.rows[0].is_admin };
  }
  if (email) {
    const r = await client.query(
      "SELECT id, email, is_admin FROM owners WHERE email = $1",
      [email],
    );
    if (r.rows.length === 0) {
      throw new OwnerLookupError("owner_not_found", `No owner with email ${email}`);
    }
    if (r.rows.length > 1) {
      throw new OwnerLookupError(
        "owner_ambiguous",
        `${r.rows.length} owners share email ${email}; re-run with --owner-id <id>`,
      );
    }
    return { id: r.rows[0].id, email: r.rows[0].email, isAdmin: r.rows[0].is_admin };
  }
  throw new OwnerLookupError("owner_unspecified", "Provide --email or --owner-id");
}

/**
 * Resolve an owner and assert they are an admin. Used by the reset CLIs
 * to verify the `--actor`. Throws `actor_not_admin` otherwise.
 */
/**
 * @param {import('pg').Client} client
 * @param {{ ownerId?: string, email?: string }} [opts]
 * @returns {Promise<{ id: string, email: string, isAdmin: boolean }>}
 */
export async function requireAdminActor(client, { ownerId, email } = {}) {
  const owner = await resolveOwner(client, { ownerId, email });
  if (owner.isAdmin !== true) {
    throw new OwnerLookupError(
      "actor_not_admin",
      `Owner ${owner.email} (${owner.id}) is not an admin — grant first with \`pnpm admin:grant\``,
    );
  }
  return owner;
}

/** Insert one AdminAuditEvent row. */
export async function writeAudit(
  client,
  { requestId, action, actorKind, targetId = null, payload = {}, sourceIp = "cli" },
) {
  await client.query(
    `INSERT INTO admin_audit_events
       (request_id, action, actor_kind, target_id, payload_json, source_ip, created_at)
     VALUES ($1, $2, $3::"AuditActorKind", $4, $5::jsonb, $6, now())`,
    [requestId, action, actorKind, targetId, JSON.stringify(payload), sourceIp],
  );
}

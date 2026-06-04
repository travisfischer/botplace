// Integration tests for the admin-account CLI logic (grant / revoke /
// list). Real Postgres; skipped when DATABASE_URL is unset (same gate
// as the other DB-touching suites). Seeds throwaway owners with random
// ids and cleans them up afterwards.

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantAdmin, revokeAdmin, listAdmins } from "@/scripts/admin/admin-accounts.mjs";
import { makeClient, resolveOwner, requireAdminActor } from "@/scripts/admin/_common.mjs";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const d = HAS_DB ? describe : describe.skip;

d("admin-accounts CLI logic", () => {
  let client: import("pg").Client;
  const createdOwnerIds: string[] = [];

  beforeAll(async () => {
    client = makeClient(process.env.DATABASE_URL);
    await client.connect();
  });

  afterAll(async () => {
    if (createdOwnerIds.length) {
      await client.query("DELETE FROM admin_audit_events WHERE target_id = ANY($1)", [
        createdOwnerIds,
      ]);
      await client.query("DELETE FROM owners WHERE id = ANY($1)", [createdOwnerIds]);
    }
    await client.end();
  });

  async function seedOwner({
    isAdmin = false,
    email,
  }: { isAdmin?: boolean; email?: string } = {}): Promise<{ id: string; email: string }> {
    const id = `owner-${randomUUID().slice(0, 8)}`;
    const e = email ?? `${id}@test.local`;
    await client.query(
      `INSERT INTO owners (id, google_sub, email, display_name, is_admin, created_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [id, `dev-${id}`, e, "Test Owner", isAdmin],
    );
    createdOwnerIds.push(id);
    return { id, email: e };
  }

  it("grantAdmin sets is_admin and writes a SEED_SCRIPT audit row", async () => {
    const owner = await seedOwner();
    const requestId = randomUUID();

    const res = await grantAdmin(client, {
      email: owner.email,
      requestId,
      sourceIp: "cli",
    });

    expect(res.ownerId).toBe(owner.id);
    expect(res.alreadyAdmin).toBe(false);

    const owners = await client.query("SELECT is_admin FROM owners WHERE id = $1", [owner.id]);
    expect(owners.rows[0].is_admin).toBe(true);

    const audit = await client.query(
      "SELECT action, actor_kind, target_id FROM admin_audit_events WHERE request_id = $1",
      [requestId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      action: "grant_admin",
      actor_kind: "SEED_SCRIPT",
      target_id: owner.id,
    });
  });

  it("grantAdmin is idempotent — alreadyAdmin true on re-grant", async () => {
    const owner = await seedOwner({ isAdmin: true });
    const res = await grantAdmin(client, { email: owner.email });
    expect(res.alreadyAdmin).toBe(true);
    const owners = await client.query("SELECT is_admin FROM owners WHERE id = $1", [owner.id]);
    expect(owners.rows[0].is_admin).toBe(true);
  });

  it("revokeAdmin clears is_admin and reports wasAdmin", async () => {
    const owner = await seedOwner({ isAdmin: true });
    const res = await revokeAdmin(client, { ownerId: owner.id });
    expect(res.wasAdmin).toBe(true);
    const owners = await client.query("SELECT is_admin FROM owners WHERE id = $1", [owner.id]);
    expect(owners.rows[0].is_admin).toBe(false);
  });

  it("listAdmins includes granted owners and excludes revoked", async () => {
    const admin = await seedOwner({ isAdmin: true });
    const plain = await seedOwner({ isAdmin: false });
    const admins = await listAdmins(client);
    const ids = admins.map((a: { id: string }) => a.id);
    expect(ids).toContain(admin.id);
    expect(ids).not.toContain(plain.id);
  });

  it("resolveOwner throws owner_not_found for an unknown email", async () => {
    await expect(
      resolveOwner(client, { email: `missing-${randomUUID()}@test.local` }),
    ).rejects.toMatchObject({ code: "owner_not_found" });
  });

  it("resolveOwner throws owner_ambiguous when an email matches >1 owner", async () => {
    const shared = `dupe-${randomUUID().slice(0, 8)}@test.local`;
    await seedOwner({ email: shared });
    await seedOwner({ email: shared });
    await expect(resolveOwner(client, { email: shared })).rejects.toMatchObject({
      code: "owner_ambiguous",
    });
  });

  it("requireAdminActor rejects a non-admin and returns an admin owner", async () => {
    const nonAdmin = await seedOwner({ isAdmin: false });
    await expect(
      requireAdminActor(client, { ownerId: nonAdmin.id }),
    ).rejects.toMatchObject({ code: "actor_not_admin" });

    const admin = await seedOwner({ isAdmin: true });
    const resolved = await requireAdminActor(client, { ownerId: admin.id });
    expect(resolved.id).toBe(admin.id);
  });
});

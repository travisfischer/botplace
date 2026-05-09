// Personal Access Tokens. The owner-scoped equivalent of bot API keys —
// long-lived bearer tokens an owner mints once after a human OAuth bootstrap
// so an agent can hit the owner-management API without driving a browser.

import { prisma } from "@/lib/prisma";
import type { AuditContext } from "@/src/bots";
import { hashKey, mintKey } from "./api-keys";
import { authFail, authOk, type AuthResult } from "./result";

export interface MintPersonalAccessTokenInput {
  ownerId: string;
  /** Owner-supplied label, e.g. "my-laptop". Free text; unique per owner is not required. */
  name: string;
  /** `process.env.BOTPLACE_API_KEY_PEPPER`. Caller fetches once and threads it through. */
  pepper: string;
  auditContext?: AuditContext;
}

export interface MintPersonalAccessTokenResult {
  id: string;
  /** Plaintext token. Show in the create response exactly once; never store. */
  plaintext: string;
  /** Display prefix for log + UI display, e.g. `bp_pat_a1b2c3d4`. */
  prefix: string;
  createdAt: Date;
}

/** Mint a fresh PAT and persist its hash. */
export async function mintPersonalAccessToken(
  input: MintPersonalAccessTokenInput,
): Promise<MintPersonalAccessTokenResult> {
  return prisma.$transaction(async (tx) => {
    const minted = mintKey("bp_pat", input.pepper);
    const row = await tx.ownerPersonalAccessToken.create({
      data: {
        ownerId: input.ownerId,
        tokenHash: minted.hash,
        prefix: minted.prefix,
        name: input.name,
      },
      select: { id: true, createdAt: true },
    });
    if (input.auditContext) {
      await tx.adminAuditEvent.create({
        data: {
          requestId: input.auditContext.requestId,
          action: "mint_pat",
          targetId: row.id,
          payloadJson: {
            owner_id: input.ownerId,
            pat_id: row.id,
            pat_prefix: minted.prefix,
            name: input.name,
            actor: input.auditContext.actor ?? null,
          },
          sourceIp: input.auditContext.sourceIp,
        },
      });
    }
    return {
      id: row.id,
      plaintext: minted.plaintext,
      prefix: minted.prefix,
      createdAt: row.createdAt,
    };
  });
}

/**
 * Resolve the owner id for a plaintext PAT. Returns a tagged result so the
 * caller can log the precise `auth_failure_reason` while still returning a
 * byte-identical 401 body across all branches.
 *
 * Failure reasons:
 *   - `wrong_credential_type` — non-`bp_pat_` prefix (caller sent something else)
 *   - `unknown_key`           — hash not in the database
 *   - `revoked_key`           — token was revoked
 */
export async function ownerIdFromPersonalAccessToken(
  plaintext: string,
  pepper: string,
): Promise<AuthResult<string>> {
  if (!plaintext.startsWith("bp_pat_")) return authFail("wrong_credential_type");
  const hash = hashKey(plaintext, pepper);
  const row = await prisma.ownerPersonalAccessToken.findUnique({
    where: { tokenHash: hash },
    select: { id: true, ownerId: true, revokedAt: true },
  });
  if (!row) return authFail("unknown_key");
  if (row.revokedAt) return authFail("revoked_key");
  // Fire-and-forget: stamp `lastUsedAt`. Failures are swallowed — auth has
  // already succeeded and the freshness signal is advisory.
  void prisma.ownerPersonalAccessToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return authOk(row.ownerId);
}

export interface PersonalAccessTokenSummary {
  id: string;
  prefix: string;
  name: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

/** All PATs owned by `ownerId`, including revoked ones (audit trail). */
export async function listPersonalAccessTokensForOwner(
  ownerId: string,
): Promise<PersonalAccessTokenSummary[]> {
  return prisma.ownerPersonalAccessToken.findMany({
    where: { ownerId },
    select: {
      id: true,
      prefix: true,
      name: true,
      createdAt: true,
      revokedAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Revoke a PAT. Owner-scoped: only the issuing owner can revoke. */
export async function revokePersonalAccessToken(input: {
  tokenId: string;
  ownerId: string;
  auditContext?: AuditContext;
}): Promise<{ revoked: boolean }> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.ownerPersonalAccessToken.updateMany({
      where: {
        id: input.tokenId,
        ownerId: input.ownerId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0 && input.auditContext) {
      await tx.adminAuditEvent.create({
        data: {
          requestId: input.auditContext.requestId,
          action: "revoke_pat_by_owner",
          targetId: input.tokenId,
          payloadJson: {
            owner_id: input.ownerId,
            pat_id: input.tokenId,
            actor: input.auditContext.actor ?? null,
          },
          sourceIp: input.auditContext.sourceIp,
        },
      });
    }
    return { revoked: result.count > 0 };
  });
}

// Snake-case JSON shapes — same rationale as `src/bots/index.ts`.

export function personalAccessTokenSummaryToJson(p: PersonalAccessTokenSummary) {
  return {
    id: p.id,
    prefix: p.prefix,
    name: p.name,
    created_at: p.createdAt.toISOString(),
    revoked_at: p.revokedAt ? p.revokedAt.toISOString() : null,
    last_used_at: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
  };
}

export function mintPersonalAccessTokenResultToJson(
  r: MintPersonalAccessTokenResult,
) {
  return {
    id: r.id,
    plaintext: r.plaintext,
    prefix: r.prefix,
    created_at: r.createdAt.toISOString(),
  };
}

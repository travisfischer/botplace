// Personal Access Tokens. The owner-scoped equivalent of bot API keys —
// long-lived bearer tokens an owner mints once after a human OAuth bootstrap
// so an agent can hit the owner-management API without driving a browser.

import { prisma } from "@/lib/prisma";
import { hashKey, mintKey } from "./api-keys";

export interface MintPersonalAccessTokenInput {
  ownerId: string;
  /** Owner-supplied label, e.g. "my-laptop". Free text; unique per owner is not required. */
  name: string;
  /** `process.env.BOTPLACE_API_KEY_PEPPER`. Caller fetches once and threads it through. */
  pepper: string;
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
  const minted = mintKey("bp_pat", input.pepper);
  const row = await prisma.ownerPersonalAccessToken.create({
    data: {
      ownerId: input.ownerId,
      tokenHash: minted.hash,
      prefix: minted.prefix,
      name: input.name,
    },
    select: { id: true, createdAt: true },
  });
  return {
    id: row.id,
    plaintext: minted.plaintext,
    prefix: minted.prefix,
    createdAt: row.createdAt,
  };
}

/**
 * Resolve the owner id for a plaintext PAT, returning null on unknown,
 * revoked, or otherwise-invalid tokens. Constant 1-row DB lookup keyed on
 * the unique `tokenHash` index.
 */
export async function ownerIdFromPersonalAccessToken(
  plaintext: string,
  pepper: string,
): Promise<string | null> {
  if (!plaintext.startsWith("bp_pat_")) return null;
  const hash = hashKey(plaintext, pepper);
  const row = await prisma.ownerPersonalAccessToken.findUnique({
    where: { tokenHash: hash },
    select: { id: true, ownerId: true, revokedAt: true },
  });
  if (!row || row.revokedAt) return null;
  // Fire-and-forget: stamp `lastUsedAt`. Failures are swallowed — auth has
  // already succeeded and the freshness signal is advisory.
  void prisma.ownerPersonalAccessToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return row.ownerId;
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
}): Promise<{ revoked: boolean }> {
  const result = await prisma.ownerPersonalAccessToken.updateMany({
    where: {
      id: input.tokenId,
      ownerId: input.ownerId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  return { revoked: result.count > 0 };
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

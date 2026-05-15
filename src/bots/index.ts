// Bot domain logic. Route handlers in `app/api/v1/bots/...` are thin glue;
// every business operation lives here so it's reachable from a future
// UI / MCP / CLI without going through HTTP.

import { prisma } from "@/lib/prisma";
import { mintKey } from "@/src/auth/api-keys";
import { AuditActorKind } from "@/generated/prisma/enums";

// Single source of truth for the rate-tier enum lives in Prisma's
// generated module. Re-exporting (rather than redeclaring) keeps the
// type aligned with the schema and the admin route's runtime validator.
// `lib/rate-limit.ts` keeps its own narrow alias on purpose so it stays
// import-free of generated code.
import { BotRateTier } from "@/generated/prisma/enums";
export { BotRateTier, AuditActorKind };
export type BotStatus = "ACTIVE" | "REVOKED";

/**
 * Audit-trail context plumbed in from the HTTP layer. When present, every
 * credential lifecycle event (mint, rotate, revoke) writes an
 * `AdminAuditEvent` row inside the same transaction as the mutation, so
 * the audit trail can never drift from reality.
 *
 * `actorKind` distinguishes who took the action at audit-query time:
 * `owner` for owner-initiated mutations through the API,
 * `admin_token` for ADMIN_TOKEN-bearing requests, `seed_script` for
 * operator-run provisioning scripts.
 */
export interface AuditContext {
  requestId: string;
  sourceIp: string;
  /** Who took the action — owner id when present, "admin_token" for the admin route. */
  actor?: string;
  /** Normalized actor type (added in M3). */
  actorKind: AuditActorKind;
}

export interface BotApiKeySummary {
  id: string;
  prefix: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

export interface BotSummary {
  id: string;
  /** M3: globally-unique slug. Canonical public identifier. */
  handle: string;
  /** M3: per-owner-unique freely-editable label. */
  displayName: string;
  status: BotStatus;
  rateTier: BotRateTier;
  createdAt: Date;
  apiKeys: BotApiKeySummary[];
}

export interface MintedBotApiKey {
  id: string;
  plaintext: string;
  prefix: string;
  createdAt: Date;
}

export interface CreateBotResult {
  id: string;
  handle: string;
  displayName: string;
  status: BotStatus;
  rateTier: BotRateTier;
  createdAt: Date;
  apiKey: MintedBotApiKey;
}

/** Atomic: create the bot row + mint its first API key in one transaction. */
export async function createBotForOwner(input: {
  ownerId: string;
  handle: string;
  displayName: string;
  pepper: string;
  auditContext?: AuditContext;
}): Promise<CreateBotResult> {
  return prisma.$transaction(async (tx) => {
    // Owner-facing create path. `rateTier` is intentionally NOT settable
    // here — owner-minted bots are always FREE. Only the operator
    // `pnpm op bot:set-tier` script can elevate (M2.5).
    const bot = await tx.bot.create({
      data: {
        ownerId: input.ownerId,
        handle: input.handle,
        displayName: input.displayName,
      },
      select: {
        id: true,
        handle: true,
        displayName: true,
        status: true,
        rateTier: true,
        createdAt: true,
      },
    });
    const minted = mintKey("bp_live", input.pepper);
    const key = await tx.botApiKey.create({
      data: { botId: bot.id, keyHash: minted.hash, prefix: minted.prefix },
      select: { id: true, createdAt: true },
    });
    if (input.auditContext) {
      await tx.adminAuditEvent.create({
        data: {
          requestId: input.auditContext.requestId,
          action: "create_bot_with_first_key",
          actorKind: input.auditContext.actorKind,
          targetId: bot.id,
          payloadJson: {
            owner_id: input.ownerId,
            bot_id: bot.id,
            bot_handle: bot.handle,
            bot_display_name: bot.displayName,
            api_key_id: key.id,
            api_key_prefix: minted.prefix,
            actor: input.auditContext.actor ?? null,
          },
          sourceIp: input.auditContext.sourceIp,
        },
      });
    }
    return {
      id: bot.id,
      handle: bot.handle,
      displayName: bot.displayName,
      status: bot.status,
      rateTier: bot.rateTier,
      createdAt: bot.createdAt,
      apiKey: {
        id: key.id,
        plaintext: minted.plaintext,
        prefix: minted.prefix,
        createdAt: key.createdAt,
      },
    };
  });
}

/** All bots owned by `ownerId`, including their non-plaintext key metadata. */
export async function listBotsForOwner(
  ownerId: string,
): Promise<BotSummary[]> {
  return prisma.bot.findMany({
    where: { ownerId },
    select: {
      id: true,
      handle: true,
      displayName: true,
      status: true,
      rateTier: true,
      createdAt: true,
      apiKeys: {
        select: {
          id: true,
          prefix: true,
          createdAt: true,
          revokedAt: true,
          lastUsedAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Mint an additional API key for an existing bot. Returns null if the bot
 * doesn't exist or doesn't belong to this owner — caller maps to 404.
 */
export async function mintBotApiKey(input: {
  botId: string;
  ownerId: string;
  pepper: string;
  auditContext?: AuditContext;
}): Promise<MintedBotApiKey | null> {
  return prisma.$transaction(async (tx) => {
    // Ownership check: only mint keys for bots this owner owns.
    const bot = await tx.bot.findFirst({
      where: { id: input.botId, ownerId: input.ownerId },
      select: { id: true, handle: true },
    });
    if (!bot) return null;
    const minted = mintKey("bp_live", input.pepper);
    const key = await tx.botApiKey.create({
      data: { botId: bot.id, keyHash: minted.hash, prefix: minted.prefix },
      select: { id: true, createdAt: true },
    });
    if (input.auditContext) {
      await tx.adminAuditEvent.create({
        data: {
          requestId: input.auditContext.requestId,
          action: "mint_bot_key",
          actorKind: input.auditContext.actorKind,
          targetId: key.id,
          payloadJson: {
            owner_id: input.ownerId,
            bot_id: bot.id,
            bot_handle: bot.handle,
            api_key_id: key.id,
            api_key_prefix: minted.prefix,
            actor: input.auditContext.actor ?? null,
          },
          sourceIp: input.auditContext.sourceIp,
        },
      });
    }
    return {
      id: key.id,
      plaintext: minted.plaintext,
      prefix: minted.prefix,
      createdAt: key.createdAt,
    };
  });
}

/**
 * Revoke a bot key by id. The `updateMany` with the bot+owner scope ensures
 * an owner can only revoke keys on bots they own. Returns false if no row
 * matched — caller maps to 404.
 */
export async function revokeBotApiKey(input: {
  keyId: string;
  botId: string;
  ownerId: string;
  auditContext?: AuditContext;
}): Promise<{ revoked: boolean }> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.botApiKey.updateMany({
      where: {
        id: input.keyId,
        botId: input.botId,
        revokedAt: null,
        bot: { ownerId: input.ownerId },
      },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0 && input.auditContext) {
      await tx.adminAuditEvent.create({
        data: {
          requestId: input.auditContext.requestId,
          action: "revoke_bot_key_by_owner",
          actorKind: input.auditContext.actorKind,
          targetId: input.keyId,
          payloadJson: {
            owner_id: input.ownerId,
            bot_id: input.botId,
            api_key_id: input.keyId,
            actor: input.auditContext.actor ?? null,
          },
          sourceIp: input.auditContext.sourceIp,
        },
      });
    }
    return { revoked: result.count > 0 };
  });
}

// Snake-case JSON shapes. The wire contract for the M1 API is uniformly
// snake_case (matches the pixel API). camelCase domain types are an
// internal/Prisma convention; never leak them through HTTP.

export function botApiKeySummaryToJson(k: BotApiKeySummary) {
  return {
    id: k.id,
    prefix: k.prefix,
    created_at: k.createdAt.toISOString(),
    revoked_at: k.revokedAt ? k.revokedAt.toISOString() : null,
    last_used_at: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
  };
}

export function botSummaryToJson(b: BotSummary) {
  return {
    id: b.id,
    // M3 hard-cut: `name` is gone. `handle` is the canonical identifier;
    // `display_name` is the freely-editable label.
    handle: b.handle,
    display_name: b.displayName,
    status: b.status,
    rate_tier: b.rateTier,
    created_at: b.createdAt.toISOString(),
    api_keys: b.apiKeys.map(botApiKeySummaryToJson),
  };
}

export function mintedBotApiKeyToJson(k: MintedBotApiKey) {
  return {
    id: k.id,
    plaintext: k.plaintext,
    prefix: k.prefix,
    created_at: k.createdAt.toISOString(),
  };
}

export function createBotResultToJson(r: CreateBotResult) {
  return {
    id: r.id,
    handle: r.handle,
    display_name: r.displayName,
    status: r.status,
    rate_tier: r.rateTier,
    created_at: r.createdAt.toISOString(),
    api_key: mintedBotApiKeyToJson(r.apiKey),
  };
}

/**
 * Atomic rotate: mint a fresh key + revoke the old one in a single
 * transaction. Used by `POST /api/v1/bots/:id/keys/:keyId/rotate` so a
 * caller never sees a window with both keys live or both revoked.
 *
 * Returns the new minted key (with plaintext, shown once); caller is
 * responsible for the 404 if `oldKeyId` doesn't match an active key on
 * a bot owned by `ownerId`.
 */
export async function rotateBotApiKey(input: {
  botId: string;
  oldKeyId: string;
  ownerId: string;
  pepper: string;
  auditContext?: AuditContext;
}): Promise<MintedBotApiKey | null> {
  return prisma.$transaction(async (tx) => {
    // Revoke first; if `count === 0` the old key isn't an active key on a
    // bot owned by this caller, and we abort without minting.
    const revoke = await tx.botApiKey.updateMany({
      where: {
        id: input.oldKeyId,
        botId: input.botId,
        revokedAt: null,
        bot: { ownerId: input.ownerId },
      },
      data: { revokedAt: new Date() },
    });
    if (revoke.count === 0) return null;
    const minted = mintKey("bp_live", input.pepper);
    const key = await tx.botApiKey.create({
      data: {
        botId: input.botId,
        keyHash: minted.hash,
        prefix: minted.prefix,
      },
      select: { id: true, createdAt: true },
    });
    if (input.auditContext) {
      await tx.adminAuditEvent.create({
        data: {
          requestId: input.auditContext.requestId,
          action: "rotate_bot_key",
          actorKind: input.auditContext.actorKind,
          targetId: key.id,
          payloadJson: {
            owner_id: input.ownerId,
            bot_id: input.botId,
            old_api_key_id: input.oldKeyId,
            new_api_key_id: key.id,
            new_api_key_prefix: minted.prefix,
            actor: input.auditContext.actor ?? null,
          },
          sourceIp: input.auditContext.sourceIp,
        },
      });
    }
    return {
      id: key.id,
      plaintext: minted.plaintext,
      prefix: minted.prefix,
      createdAt: key.createdAt,
    };
  });
}

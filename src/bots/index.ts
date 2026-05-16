// Bot domain logic. Route handlers in `app/api/v1/bots/...` are thin glue;
// every business operation lives here so it's reachable from a future
// UI / MCP / CLI without going through HTTP.

import { MAX_DESCRIPTION_LENGTH } from "@/lib/limits";
import {
  BLOCKED_LIST_VERSION,
  containsBlockedTerm,
  denylistTermHashForLog,
  redactUrls,
} from "@/lib/moderation";
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
 * `OWNER` for owner-initiated mutations through the API,
 * `ADMIN_TOKEN` for ADMIN_TOKEN-bearing requests, `SEED_SCRIPT` for
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
  /** Self-declared bio. Null when unset. Post-moderation form (URLs redacted). */
  description: string | null;
  /** Bumps on every description write. Null while description is unset. */
  descriptionUpdatedAt: Date | null;
  status: BotStatus;
  rateTier: BotRateTier;
  createdAt: Date;
  apiKeys: BotApiKeySummary[];
}

/**
 * Public bot-detail shape. No `id`, no `apiKeys` — `handle` is the
 * canonical public identifier. Used by `PATCH /api/v1/bots/me` (echoes
 * post-write state) and `GET /api/v1/public/bots/[handle_or_id]`.
 */
export interface BotPublicDetail {
  handle: string;
  displayName: string;
  description: string | null;
  descriptionUpdatedAt: Date | null;
  rateTier: BotRateTier;
  createdAt: Date;
  /** Most recent `PixelEvent.createdAt` across all sectors. Null if the bot has never written. */
  lastSeenAt: Date | null;
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
  description: string | null;
  descriptionUpdatedAt: Date | null;
  status: BotStatus;
  rateTier: BotRateTier;
  createdAt: Date;
  apiKey: MintedBotApiKey;
}

/**
 * Discriminator for unique-constraint violations on `Bot`. Two indexes
 * can fire on owner-create:
 *
 *   - `handle_taken` — global uniqueness on `handle`.
 *   - `display_name_taken` — per-owner uniqueness on `(ownerId, displayName)`.
 *
 * `null` means the error is a P2002 we don't recognize — caller should
 * re-throw as a 500 rather than guess.
 */
export type BotUniqueConflict = "handle_taken" | "display_name_taken" | null;

/**
 * Classify a Prisma `P2002` unique-constraint error against the M3
 * Bot indexes. Returns `null` for non-P2002 errors and for P2002 errors
 * whose target doesn't match a known bot index — caller maps `null` to
 * "re-throw as internal_error" so undocumented constraint violations
 * stay loud.
 *
 * Single source of truth for this mapping; route handlers and server
 * actions both call this helper rather than inspecting `err.meta.target`
 * inline (the M3 multi-reviewer review's P2.7).
 */
export function classifyBotUniqueViolation(err: unknown): BotUniqueConflict {
  if (typeof err !== "object" || err === null) return null;
  const code = (err as { code?: unknown }).code;
  const meta = (err as { meta?: { target?: unknown } }).meta;
  if (code === "P2002" && meta) {
    const target = Array.isArray(meta.target)
      ? meta.target.join(",")
      : typeof meta.target === "string"
        ? meta.target
        : "";
    if (target.includes("handle")) return "handle_taken";
    if (target.includes("display_name")) return "display_name_taken";
  }
  // Fallback: when Prisma wraps the P2002 (e.g. inside $transaction) the
  // top-level `code`/`meta` can disappear, but the message text still
  // carries "Unique constraint failed on the fields: (`<col>`)". Match
  // on that as a safety net so we never bubble raw Prisma noise to UIs.
  const message =
    typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message
      : "";
  const m = /Unique constraint failed on the fields:\s*\(`?([^`)]+)`?\)/.exec(
    message,
  );
  if (m) {
    const fields = m[1];
    if (fields.includes("handle")) return "handle_taken";
    if (fields.includes("display_name")) return "display_name_taken";
  }
  return null;
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
    // from the request — the value is set here, not by the caller. The
    // operator `pnpm op bot:set-tier` script remains the only way to
    // change tier after creation.
    //
    // EXPERIMENT (2026-05-15, pre-MVP): defaulting to POWER instead of
    // FREE while we experiment with what early bot authors actually
    // build. FREE's 1 write / 60s ceiling makes the hello-world
    // experience too sluggish to learn from. Revert by removing the
    // explicit `rateTier` below (schema default falls back to FREE) and
    // re-syncing the build-docs in `src/build-docs/content/{api,agents}.ts`.
    const bot = await tx.bot.create({
      data: {
        ownerId: input.ownerId,
        handle: input.handle,
        displayName: input.displayName,
        rateTier: "POWER",
      },
      select: {
        id: true,
        handle: true,
        displayName: true,
        description: true,
        descriptionUpdatedAt: true,
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
      description: bot.description,
      descriptionUpdatedAt: bot.descriptionUpdatedAt,
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
      description: true,
      descriptionUpdatedAt: true,
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
    description: b.description,
    description_updated_at: b.descriptionUpdatedAt?.toISOString() ?? null,
    status: b.status,
    rate_tier: b.rateTier,
    created_at: b.createdAt.toISOString(),
    api_keys: b.apiKeys.map(botApiKeySummaryToJson),
  };
}

/**
 * Operator kill-switch for description-bearing public reads. When
 * `BOTPLACE_DISABLE_DESCRIPTIONS=1` is set in process env, every public
 * read that surfaces `description` (or `bot_description`) returns null
 * for that field, regardless of what's in the DB. Use during incident
 * response if a moderation false-negative reaches public attribution —
 * the env var takes effect on the next request (no redeploy needed
 * once the env var is updated in Vercel project settings).
 *
 * Reads only. Writes are NOT gated by this — bots and owners can still
 * update / clear descriptions while reads are suppressed, so the fix
 * loop (owner clears the offending description) keeps working.
 */
export function descriptionsDisabled(): boolean {
  return process.env.BOTPLACE_DISABLE_DESCRIPTIONS === "1";
}

export function botPublicDetailToJson(b: BotPublicDetail) {
  const disabled = descriptionsDisabled();
  return {
    handle: b.handle,
    display_name: b.displayName,
    description: disabled ? null : b.description,
    description_updated_at: disabled
      ? null
      : (b.descriptionUpdatedAt?.toISOString() ?? null),
    rate_tier: b.rateTier,
    created_at: b.createdAt.toISOString(),
    last_seen_at: b.lastSeenAt?.toISOString() ?? null,
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
    description: r.description,
    description_updated_at: r.descriptionUpdatedAt?.toISOString() ?? null,
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

// ----------------------------------------------------------------------------
// Description writes + public detail reads (post-MVP bot-descriptions feature)
// ----------------------------------------------------------------------------

export type DescriptionRejection =
  | { kind: "type" }
  | { kind: "too_long"; length: number }
  | {
      kind: "blocked";
      /**
       * Short HMAC of the matched deny-list term (16 hex chars), or
       * undefined if the moderation HMAC secret isn't available. Safe
       * to surface in logs — preserves the no-echo invariant. Operators
       * resolve it back to a term locally; see `lib/moderation/index.ts`
       * `hashBlockedTerm`.
       */
      termHash?: string;
    }
  | { kind: "not_found" };

export type DescriptionRejectionSlug =
  | "description_invalid"
  | "description_too_long"
  | "description_blocked"
  | "bot_not_found";

/**
 * Map a `DescriptionRejection` to a stable `{slug, message}` pair both
 * write adapters (HTTP PATCH and the owner-side server action) emit.
 * Single source of truth for response phrasing — if a slug changes,
 * every consumer changes together.
 *
 * Messages are intentionally generic; the deny-list-match case never
 * echoes the matched term.
 */
export function describeDescriptionRejection(
  r: DescriptionRejection,
): { slug: DescriptionRejectionSlug; message: string } {
  switch (r.kind) {
    case "type":
      return {
        slug: "description_invalid",
        message: "`description` must be a string or null",
      };
    case "too_long":
      return {
        slug: "description_too_long",
        message: `\`description\` must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
      };
    case "blocked":
      return {
        slug: "description_blocked",
        message: "`description` is not allowed",
      };
    case "not_found":
      return {
        slug: "bot_not_found",
        message: "Bot not found",
      };
  }
}

export type UpdateDescriptionResult =
  | {
      ok: true;
      bot: BotPublicDetail;
      /** Final stored form (post-redaction). `null` if cleared. */
      description: string | null;
      /** Number of URL/email redactions applied to the stored form. */
      redactions: number;
      /** Stable version stamp of the deny list used. */
      denylistVersion: string;
    }
  | { ok: false; rejection: DescriptionRejection; denylistVersion: string };

/**
 * Validate + moderate + persist a description update for a single bot.
 *
 * Input `raw`:
 *   - `string` → trim, normalize empty → null, length-check, URL-redact,
 *                deny-list check, store.
 *   - `null`   → clear the field.
 *   - anything else → `{ kind: "type" }`.
 *
 * If `ownerId` is provided, scopes the update to a bot owned by that
 * owner — used by the owner UI server action so a malicious form post
 * can't update another owner's description. The bot-self PATCH leaves
 * `ownerId` unset (auth already proved bot identity via the key).
 *
 * Returns `{ kind: "not_found" }` when scoped lookup misses.
 */
export async function updateBotDescription(input: {
  botId: string;
  raw: unknown;
  ownerId?: string;
}): Promise<UpdateDescriptionResult> {
  if (input.raw !== null && typeof input.raw !== "string") {
    return {
      ok: false,
      rejection: { kind: "type" },
      denylistVersion: BLOCKED_LIST_VERSION,
    };
  }

  let stored: string | null = null;
  let redactions = 0;
  if (typeof input.raw === "string") {
    const trimmed = input.raw.trim();
    if (trimmed.length > 0) {
      if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
        return {
          ok: false,
          rejection: { kind: "too_long", length: trimmed.length },
          denylistVersion: BLOCKED_LIST_VERSION,
        };
      }
      const redacted = redactUrls(trimmed);
      if (containsBlockedTerm(redacted.text)) {
        return {
          ok: false,
          rejection: {
            kind: "blocked",
            termHash: denylistTermHashForLog(redacted.text),
          },
          denylistVersion: BLOCKED_LIST_VERSION,
        };
      }
      stored = redacted.text;
      redactions = redacted.redactions;
    }
  }

  // Both paths use `updateMany` + count check so we can detect a
  // missing-row case without depending on Prisma's P2025 throw. The
  // bot-self PATCH path has auth already, but a row could in principle
  // be deleted between auth and this write — handling it explicitly is
  // cheap and keeps the unscoped/scoped behavior symmetric.
  const where =
    input.ownerId !== undefined
      ? { id: input.botId, ownerId: input.ownerId }
      : { id: input.botId };
  const updated = await prisma.bot.updateMany({
    where,
    data: {
      description: stored,
      descriptionUpdatedAt: new Date(),
    },
  });
  if (updated.count === 0) {
    return {
      ok: false,
      rejection: { kind: "not_found" },
      denylistVersion: BLOCKED_LIST_VERSION,
    };
  }

  // Read back the fresh public detail. `lastSeenAt` requires a separate
  // aggregate query; run it in parallel with the read-back.
  const [bot, lastSeenAt] = await Promise.all([
    prisma.bot.findUnique({
      where: { id: input.botId },
      select: {
        handle: true,
        displayName: true,
        description: true,
        descriptionUpdatedAt: true,
        rateTier: true,
        createdAt: true,
      },
    }),
    lastSeenAtForBot(input.botId),
  ]);
  // bot is non-null here: either the unscoped update succeeded, or the
  // scoped updateMany matched a row.
  return {
    ok: true,
    bot: { ...bot!, lastSeenAt },
    description: stored,
    redactions,
    denylistVersion: BLOCKED_LIST_VERSION,
  };
}

/** Most recent `PixelEvent.createdAt` across all sectors for this bot. */
async function lastSeenAtForBot(botId: string): Promise<Date | null> {
  const row = await prisma.pixelEvent.findFirst({
    where: { botId },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return row?.createdAt ?? null;
}

/**
 * Public bot-detail lookup with dual key — either a globally-unique
 * `handle` or a cuid id. The caller is responsible for the shape-based
 * dispatch (cuid: `/^c[a-z0-9]{24}$/` → `id`; otherwise `handle`).
 *
 * Returns null when the bot doesn't exist; caller maps to 404.
 */
export async function getBotPublicDetail(by: {
  handle?: string;
  id?: string;
}): Promise<BotPublicDetail | null> {
  if (!by.handle && !by.id) return null;
  const bot = await prisma.bot.findUnique({
    where: by.id ? { id: by.id } : { handle: by.handle! },
    select: {
      id: true,
      handle: true,
      displayName: true,
      description: true,
      descriptionUpdatedAt: true,
      rateTier: true,
      createdAt: true,
    },
  });
  if (!bot) return null;
  const lastSeenAt = await lastSeenAtForBot(bot.id);
  return {
    handle: bot.handle,
    displayName: bot.displayName,
    description: bot.description,
    descriptionUpdatedAt: bot.descriptionUpdatedAt,
    rateTier: bot.rateTier,
    createdAt: bot.createdAt,
    lastSeenAt,
  };
}

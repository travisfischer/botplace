// Server actions for the /bots UI. Each is a thin wrapper around the
// equivalent business-logic function in src/<domain>/, identical to what
// the HTTP route handlers call. The UI is therefore a thin client of the
// same domain logic — agent-native principle, applied at the action layer.

"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { MAX_NAME_LENGTH } from "@/lib/route-helpers";
import {
  listPersonalAccessTokensForOwner,
  mintPersonalAccessToken,
  revokePersonalAccessToken,
} from "@/src/auth/pat";
import {
  AuditActorKind,
  classifyBotUniqueViolation,
  createBotForOwner,
  describeDescriptionRejection,
  mintBotApiKey,
  revokeBotApiKey,
  updateBotDescription,
} from "@/src/bots";
import { validateDisplayName } from "@/src/bots/display-name";
import { validateHandle } from "@/src/bots/handle";
import { log } from "@/lib/log";

export interface CreateBotState {
  ok: boolean;
  message?: string;
  /** Plaintext shown once, on success only. */
  plaintext?: string;
  prefix?: string;
  /** M3: handle is the canonical identifier shown after create. */
  handle?: string;
  displayName?: string;
}

export interface CreatePatState {
  ok: boolean;
  message?: string;
  plaintext?: string;
  prefix?: string;
  patName?: string;
}

function pepperOrDie(): string {
  const p = process.env.BOTPLACE_API_KEY_PEPPER;
  if (!p) throw new Error("BOTPLACE_API_KEY_PEPPER missing in process env");
  return p;
}

async function requireOwnerId(): Promise<string> {
  const session = await auth();
  if (!session?.ownerId) throw new Error("unauthorized");
  return session.ownerId;
}

export async function createBotAction(
  _prev: CreateBotState | null,
  formData: FormData,
): Promise<CreateBotState> {
  const handle = String(formData.get("handle") ?? "");
  const handleErr = validateHandle(handle);
  if (handleErr) return { ok: false, message: handleErr.message };

  const dn = validateDisplayName(formData.get("display_name") ?? "");
  if (!dn.ok) return { ok: false, message: dn.message };

  try {
    const ownerId = await requireOwnerId();
    const result = await createBotForOwner({
      ownerId,
      handle,
      displayName: dn.value,
      pepper: pepperOrDie(),
      auditContext: {
        requestId: crypto.randomUUID(),
        sourceIp: "ui",
        actor: ownerId,
        actorKind: AuditActorKind.OWNER,
      },
    });
    revalidatePath("/bots");
    return {
      ok: true,
      plaintext: result.apiKey.plaintext,
      prefix: result.apiKey.prefix,
      handle: result.handle,
      displayName: result.displayName,
    };
  } catch (err: unknown) {
    // Shared classifier in src/bots picks the right per-field error;
    // null means "P2002 we don't recognize, or a non-Prisma error" →
    // surface the generic message so we don't pretend we know.
    const conflict = classifyBotUniqueViolation(err);
    if (conflict === "handle_taken") {
      return {
        ok: false,
        message: "That handle is already in use. Pick a different one.",
      };
    }
    if (conflict === "display_name_taken") {
      return {
        ok: false,
        message: "You already have a bot with that display name.",
      };
    }
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function mintKeyAction(formData: FormData): Promise<void> {
  const ownerId = await requireOwnerId();
  const botId = String(formData.get("botId") ?? "");
  if (!botId) return;
  await mintBotApiKey({
    botId,
    ownerId,
    pepper: pepperOrDie(),
    auditContext: {
      requestId: crypto.randomUUID(),
      sourceIp: "ui",
      actor: ownerId,
      actorKind: AuditActorKind.OWNER,
    },
  });
  revalidatePath("/bots");
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  const ownerId = await requireOwnerId();
  const keyId = String(formData.get("keyId") ?? "");
  const botId = String(formData.get("botId") ?? "");
  if (!keyId || !botId) return;
  await revokeBotApiKey({
    keyId,
    botId,
    ownerId,
    auditContext: {
      requestId: crypto.randomUUID(),
      sourceIp: "ui",
      actor: ownerId,
      actorKind: AuditActorKind.OWNER,
    },
  });
  revalidatePath("/bots");
}

export async function createPatAction(
  _prev: CreatePatState | null,
  formData: FormData,
): Promise<CreatePatState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Name is required" };
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      message: `Name must be ${MAX_NAME_LENGTH} characters or fewer`,
    };
  }
  const ownerId = await requireOwnerId();
  const result = await mintPersonalAccessToken({
    ownerId,
    name,
    pepper: pepperOrDie(),
    auditContext: {
      requestId: crypto.randomUUID(),
      sourceIp: "ui",
      actor: ownerId,
      actorKind: AuditActorKind.OWNER,
    },
  });
  revalidatePath("/bots");
  return {
    ok: true,
    plaintext: result.plaintext,
    prefix: result.prefix,
    patName: name,
  };
}

export async function revokePatAction(formData: FormData): Promise<void> {
  const ownerId = await requireOwnerId();
  const tokenId = String(formData.get("tokenId") ?? "");
  if (!tokenId) return;
  await revokePersonalAccessToken({
    tokenId,
    ownerId,
    auditContext: {
      requestId: crypto.randomUUID(),
      sourceIp: "ui",
      actor: ownerId,
      actorKind: AuditActorKind.OWNER,
    },
  });
  revalidatePath("/bots");
}

export async function listPatsForCurrentOwner() {
  const ownerId = await requireOwnerId();
  return listPersonalAccessTokensForOwner(ownerId);
}

export interface UpdateDescriptionState {
  ok: boolean;
  botId?: string;
  message?: string;
  /**
   * Echoed so the user can correlate UI feedback with a server log
   * line — surfaces in the form's saved/error chip.
   */
  requestId?: string;
}

// Soft cap to short-circuit hostile-large form posts before we run them
// through the moderation pipeline. The bot-self HTTP route has a hard
// MAX_BODY_BYTES check at the JSON-parse boundary; server actions don't
// expose that knob, so we guard at the action entry. 4× the canonical
// length cap is generous slack for whitespace + multibyte characters.
const SOFT_RAW_DESCRIPTION_BYTE_CAP = 4_096;

export async function updateDescriptionAction(
  _prev: UpdateDescriptionState | null,
  formData: FormData,
): Promise<UpdateDescriptionState> {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const path = "/bots#updateDescription";
  const ownerId = await requireOwnerId();
  const botId = String(formData.get("botId") ?? "");
  if (!botId) {
    log("warn", {
      request_id: requestId,
      path,
      status: 400,
      error_slug: "missing_bot_id",
      auth_type: "session",
      actor: "owner",
      owner_id: ownerId,
      latency_ms: Date.now() - startedAt,
    });
    return { ok: false, message: "Missing bot id", requestId };
  }

  // Empty string is the owner's "clear it" gesture from the textarea.
  // `updateBotDescription` trims and treats whitespace-only as null.
  const raw = formData.get("description");
  const rawString = raw === null ? null : String(raw);

  if (rawString !== null && rawString.length > SOFT_RAW_DESCRIPTION_BYTE_CAP) {
    log("warn", {
      request_id: requestId,
      path,
      status: 413,
      error_slug: "body_too_large",
      auth_type: "session",
      actor: "owner",
      owner_id: ownerId,
      bot_id: botId,
      latency_ms: Date.now() - startedAt,
    });
    return {
      ok: false,
      botId,
      requestId,
      message: "Description is too large",
    };
  }

  const result = await updateBotDescription({
    botId,
    ownerId,
    raw: rawString,
  });

  if (!result.ok) {
    const { slug, message } = describeDescriptionRejection(result.rejection);
    const status = slug === "bot_not_found" ? 404 : 400;
    log("warn", {
      request_id: requestId,
      path,
      status,
      error_slug: slug,
      auth_type: "session",
      actor: "owner",
      owner_id: ownerId,
      bot_id: botId,
      field: "description",
      length:
        result.rejection.kind === "too_long"
          ? result.rejection.length
          : undefined,
      denylist_version: result.denylistVersion,
      denylist_term_hash:
        result.rejection.kind === "blocked"
          ? result.rejection.termHash
          : undefined,
      latency_ms: Date.now() - startedAt,
    });
    return { ok: false, botId, requestId, message };
  }

  log("info", {
    request_id: requestId,
    path,
    status: 200,
    auth_type: "session",
    actor: "owner",
    owner_id: ownerId,
    bot_id: botId,
    field: "description",
    length: result.description?.length ?? 0,
    redactions_count: result.redactions,
    denylist_version: result.denylistVersion,
    latency_ms: Date.now() - startedAt,
  });

  revalidatePath("/bots");
  return { ok: true, botId, requestId };
}

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
  createBotForOwner,
  mintBotApiKey,
  revokeBotApiKey,
} from "@/src/bots";
import { validateHandle } from "@/src/bots/handle";

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

  const displayName = String(formData.get("display_name") ?? "").trim();
  if (!displayName) return { ok: false, message: "Display name is required" };
  if (displayName.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      message: `Display name must be ${MAX_NAME_LENGTH} characters or fewer`,
    };
  }

  try {
    const ownerId = await requireOwnerId();
    const result = await createBotForOwner({
      ownerId,
      handle,
      displayName,
      pepper: pepperOrDie(),
      auditContext: {
        requestId: crypto.randomUUID(),
        sourceIp: "ui",
        actor: ownerId,
        actorKind: AuditActorKind.owner,
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
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: unknown }).code === "P2002"
    ) {
      const target = (() => {
        const meta = (err as { meta?: { target?: unknown } }).meta;
        if (!meta) return "";
        if (Array.isArray(meta.target)) return meta.target.join(",");
        if (typeof meta.target === "string") return meta.target;
        return "";
      })();
      if (target.includes("handle")) {
        return {
          ok: false,
          message: "That handle is already in use. Pick a different one.",
        };
      }
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
      actorKind: AuditActorKind.owner,
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
      actorKind: AuditActorKind.owner,
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
      actorKind: AuditActorKind.owner,
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
      actorKind: AuditActorKind.owner,
    },
  });
  revalidatePath("/bots");
}

export async function listPatsForCurrentOwner() {
  const ownerId = await requireOwnerId();
  return listPersonalAccessTokensForOwner(ownerId);
}

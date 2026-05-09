// Server actions for the /bots UI. Each is a thin wrapper around the
// equivalent business-logic function in src/<domain>/, identical to what
// the HTTP route handlers call. The UI is therefore a thin client of the
// same domain logic — agent-native principle, applied at the action layer.

"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import {
  listPersonalAccessTokensForOwner,
  mintPersonalAccessToken,
  revokePersonalAccessToken,
} from "@/src/auth/pat";
import {
  createBotForOwner,
  mintBotApiKey,
  revokeBotApiKey,
} from "@/src/bots";

export interface CreateBotState {
  ok: boolean;
  message?: string;
  /** Plaintext shown once, on success only. */
  plaintext?: string;
  prefix?: string;
  botName?: string;
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
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Name is required" };
  try {
    const ownerId = await requireOwnerId();
    const result = await createBotForOwner({
      ownerId,
      name,
      pepper: pepperOrDie(),
    });
    revalidatePath("/bots");
    return {
      ok: true,
      plaintext: result.apiKey.plaintext,
      prefix: result.apiKey.prefix,
      botName: result.name,
    };
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: unknown }).code === "P2002"
    ) {
      return { ok: false, message: "You already have a bot with that name" };
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
  await mintBotApiKey({ botId, ownerId, pepper: pepperOrDie() });
  revalidatePath("/bots");
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  const ownerId = await requireOwnerId();
  const keyId = String(formData.get("keyId") ?? "");
  const botId = String(formData.get("botId") ?? "");
  if (!keyId || !botId) return;
  await revokeBotApiKey({ keyId, botId, ownerId });
  revalidatePath("/bots");
}

export async function createPatAction(
  _prev: CreatePatState | null,
  formData: FormData,
): Promise<CreatePatState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Name is required" };
  const ownerId = await requireOwnerId();
  const result = await mintPersonalAccessToken({
    ownerId,
    name,
    pepper: pepperOrDie(),
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
  await revokePersonalAccessToken({ tokenId, ownerId });
  revalidatePath("/bots");
}

export async function listPatsForCurrentOwner() {
  const ownerId = await requireOwnerId();
  return listPersonalAccessTokensForOwner(ownerId);
}

// Shared helpers for the M2.5 launch bots (visitor-pulse, sparkle, conway).
// Each bot runs as a Vercel cron route under `app/api/cron/<name>/route.ts`.
// They call the **public** read endpoints (consistent with M2.5's "public
// API is rich enough" throughline) and POST writes through the regular
// `/api/v1/pixels` endpoint so their activity hits the same audit, log,
// and rate-limit machinery as any external bot.
//
// Auth model:
//   - Cron requests carry `Authorization: Bearer <CRON_SECRET>` automatically
//     when Vercel's cron infra triggers them. We verify constant-time-ish
//     against the env-stored secret.
//   - Outgoing pixel writes use the bot's `bp_live_...` POWER-tier key,
//     read from env. The seed-launch-bots script printed the plaintext;
//     operator copies it into Vercel project env per bot.

import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";

import { parseAuthHeader } from "@/src/auth/api-keys";

/**
 * Constant-time-ish check that the incoming request carries the Vercel
 * cron secret. Same shape as the admin-token check in
 * `app/api/v1/admin/revoke-key/route.ts` — both sides hashed to a fixed
 * 32-byte buffer before timingSafeEqual.
 *
 * Vercel sets `Authorization: Bearer <CRON_SECRET>` on requests it
 * routes to a cron path. Locally (manual probe), pass the same header
 * to exercise the route.
 */
export function isAuthorizedCron(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length === 0) return false;
  const provided = parseAuthHeader(request.headers.get("authorization")) ?? "";
  const expectedHash = createHash("sha256").update(expected).digest();
  const providedHash = createHash("sha256").update(provided).digest();
  try {
    return timingSafeEqual(
      Buffer.from(expectedHash),
      Buffer.from(providedHash),
    );
  } catch {
    return false;
  }
}

/**
 * Base URL the launch bots use for their outbound HTTP calls. Defaults
 * to https://botplace.app; override via BOTPLACE_API_BASE_URL for
 * preview/staging.
 */
export function apiBase(): string {
  return process.env.BOTPLACE_API_BASE_URL ?? "https://botplace.app";
}

export interface WritePixelInput {
  apiKey: string;
  sectorId: string;
  x: number;
  y: number;
  color: number;
}

export interface WritePixelResult {
  ok: boolean;
  status: number;
  /** Stringified BigInt; same shape as POST /api/v1/pixels response. */
  chunk_version?: string;
  /** Filled when ok===false. */
  error?: string;
}

/**
 * POST one pixel via the public /api/v1/pixels endpoint, signed with
 * the bot's API key. Returns a result object so the caller can decide
 * whether to retry, sleep, or surface the error.
 *
 * AbortSignal is required; the caller threads its tick's signal so the
 * fetch cancels cleanly if the function times out.
 */
export async function writePixel(
  input: WritePixelInput,
  signal: AbortSignal,
): Promise<WritePixelResult> {
  const res = await fetch(`${apiBase()}/api/v1/pixels`, {
    method: "POST",
    signal,
    headers: {
      "Authorization": `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sector_id: input.sectorId,
      x: input.x,
      y: input.y,
      color: input.color,
    }),
  });
  if (!res.ok) {
    let errSlug = `http_${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (typeof j.error === "string") errSlug = j.error;
    } catch {
      // body wasn't JSON; keep the http_* slug
    }
    return { ok: false, status: res.status, error: errSlug };
  }
  const body = (await res.json()) as { chunk_version?: string };
  return {
    ok: true,
    status: res.status,
    chunk_version: body.chunk_version,
  };
}

/**
 * Sleep for `ms` milliseconds, abortable. Used between pixel writes to
 * honor the POWER tier's 1/sec/bot bucket — 1.1s gives a small safety
 * margin against clock skew.
 */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    });
  });
}

/** Minimal shape of `/api/v1/public/sectors/:id/events`. */
export interface PublicEvent {
  x: number;
  y: number;
  color: number;
  accepted_at: string;
  chunk_version_after: string;
  bot_name: string;
}

export async function fetchEvents(
  sectorId: string,
  limit: number,
  signal: AbortSignal,
): Promise<PublicEvent[]> {
  const res = await fetch(
    `${apiBase()}/api/v1/public/sectors/${sectorId}/events?limit=${limit}`,
    { signal, headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`events ${res.status}`);
  return (await res.json()) as PublicEvent[];
}

export async function fetchViewers(
  sectorId: string,
  signal: AbortSignal,
): Promise<{ active: number; window_seconds: number }> {
  const res = await fetch(
    `${apiBase()}/api/v1/public/sectors/${sectorId}/viewers`,
    { signal, headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`viewers ${res.status}`);
  return (await res.json()) as { active: number; window_seconds: number };
}

export async function fetchChunkBytes(
  sectorId: string,
  cx: number,
  cy: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const res = await fetch(
    `${apiBase()}/api/v1/public/sectors/${sectorId}/chunks/${cx}/${cy}`,
    { signal },
  );
  if (!res.ok) throw new Error(`chunk ${res.status} (${cx},${cy})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Sector metadata shape the bots care about. */
export interface SectorMeta {
  id: string;
  width: number;
  height: number;
  chunk_size: number;
  chunks_x: number;
  chunks_y: number;
  default_color: number;
  palette: string[];
}

export async function fetchSectorMeta(
  sectorId: string,
  signal: AbortSignal,
): Promise<SectorMeta> {
  const res = await fetch(
    `${apiBase()}/api/v1/public/sectors/${sectorId}`,
    { signal, headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`sector ${res.status}`);
  return (await res.json()) as SectorMeta;
}

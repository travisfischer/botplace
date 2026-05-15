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
 * Soft-launch gate for the M2.5 cron-driven launch bots. Vercel
 * auto-deploys on merge and the cron schedule (`* * * * *`) fires the
 * moment the new build is live — before the operator has finished
 * Phase 2 (seed bots) and Phase 3 (wire `M25_*_KEY` env vars). To
 * avoid 500-noise during that window, each cron route short-circuits
 * to a 200 `{ skipped: true, reason: "bots_disabled" }` whenever this
 * flag is not set to the literal string `"true"`. The operator flips
 * it after provisioning to wake the bots.
 *
 * Truthy values accepted: `"true"`, `"1"`, `"yes"` (case-insensitive),
 * to give the operator some latitude when typing values into the
 * Vercel dashboard. Anything else (including unset) means "disabled."
 */
export function isLaunchBotsEnabled(): boolean {
  const raw = process.env.M25_BOTS_ENABLED;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/**
 * Production canonical base URL. Hardcoded so a compromised or
 * mistyped env var cannot redirect POWER-tier bot writes (or the
 * `Authorization: Bearer bp_live_…` header that travels with them)
 * to an attacker-controlled host. Override is only honored outside
 * production, and even then is validated against a known-good shape.
 */
const PROD_BASE_URL = "https://botplace.app";

/**
 * True when this process is the live production deploy. Vercel sets
 * `VERCEL_ENV=production` only on the production deployment;
 * preview and dev deployments use other values, and local runs have
 * the var unset. We treat anything other than the explicit
 * "production" sentinel as non-production for the purposes of the
 * base-URL override.
 */
function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * Sanity check on a non-production override. The override must either
 * point at the production host (no-op) or a known-safe shape — a
 * botplace.app subdomain (Vercel preview deploys use these) or a
 * localhost / loopback URL for dev. Anything else is rejected so a
 * fat-fingered env var or compromised override can't exfiltrate the
 * POWER-tier bearer token to an arbitrary host.
 */
function isAllowedOverride(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.host === "botplace.app") return true;
  if (url.host.endsWith(".botplace.app")) return true;
  if (url.hostname === "localhost") return true;
  if (url.hostname === "127.0.0.1") return true;
  return false;
}

/**
 * Base URL the launch bots use for their outbound HTTP calls. In
 * production this is hardcoded; in preview/dev an override is honored
 * iff it passes `isAllowedOverride`.
 */
export function apiBase(): string {
  if (isProduction()) return PROD_BASE_URL;
  const override = process.env.BOTPLACE_API_BASE_URL;
  if (!override) return PROD_BASE_URL;
  if (!isAllowedOverride(override)) {
    // Treat a malformed override as if it weren't set rather than
    // throwing — the bot ticks should keep working against prod even
    // if someone fat-fingers a preview env var.
    return PROD_BASE_URL;
  }
  return override.replace(/\/+$/, "");
}

export interface WritePixelInput {
  apiKey: string;
  sectorId: string;
  x: number;
  y: number;
  color: number;
  /**
   * Cron-tick request id. Forwarded as `X-Botplace-Parent-Request-Id`
   * on the pixel-write so operator log queries can stitch the tick to
   * the downstream `/api/v1/pixels` log line.
   */
  parentRequestId?: string;
}

export interface WritePixelResult {
  ok: boolean;
  status: number;
  /** Stringified BigInt; same shape as POST /api/v1/pixels response. */
  chunk_version?: string;
  /** Filled when ok===false. */
  error?: string;
  /**
   * The server's own request id, echoed from the JSON response body
   * (both success and error). Lets the caller log "cron tick X invoked
   * pixel-write Y" so an operator can pivot between layers.
   */
  serverRequestId?: string;
}

/** Custom header name for parent-request-id propagation. Documented in `docs/api/v1.md`. */
const PARENT_REQUEST_ID_HEADER = "X-Botplace-Parent-Request-Id";

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
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${input.apiKey}`,
    "Content-Type": "application/json",
  };
  if (input.parentRequestId) {
    headers[PARENT_REQUEST_ID_HEADER] = input.parentRequestId;
  }
  const res = await fetch(`${apiBase()}/api/v1/pixels`, {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify({
      sector_id: input.sectorId,
      x: input.x,
      y: input.y,
      color: input.color,
    }),
  });
  if (!res.ok) {
    let errSlug = `http_${res.status}`;
    let serverRequestId: string | undefined;
    try {
      const j = (await res.json()) as { error?: string; request_id?: string };
      if (typeof j.error === "string") errSlug = j.error;
      if (typeof j.request_id === "string") serverRequestId = j.request_id;
    } catch {
      // body wasn't JSON; keep the http_* slug
    }
    return { ok: false, status: res.status, error: errSlug, serverRequestId };
  }
  const body = (await res.json()) as {
    chunk_version?: string;
    request_id?: string;
  };
  return {
    ok: true,
    status: res.status,
    chunk_version: body.chunk_version,
    serverRequestId: body.request_id,
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
  bot_handle: string;
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

// Route-handler helpers for the owner-management API. Centralizes the
// boilerplate every owner endpoint needs: request id, structured logging,
// auth resolution, and uniformly-shaped error/success bodies.
//
// Use from any handler under `app/api/v1/bots/...` or `app/api/v1/owner/...`.
// The pixel-write and read endpoints predate this helper and have their
// own (slightly different) logging shape; don't try to unify them yet.

import { randomUUID } from "node:crypto";

import { ownerAuthFromRequest } from "@/src/auth/authenticate";
import { clientIpFrom as httpClientIpFrom } from "./http";
import { MAX_NAME_LENGTH } from "./limits";
import { log, type LogFields, type LogLevel } from "./log";
import {
  checkOwnerWriteRateLimit,
  ownerWriteRateLimitHeaders,
} from "./rate-limit";

// Re-export for callers that already imported it from here.
export const clientIpFrom = httpClientIpFrom;
export { MAX_NAME_LENGTH };

export interface RouteContext {
  requestId: string;
  startedAt: number;
  path: string;
  /** Best-effort client IP (X-Forwarded-For first hop, X-Real-IP fallback). */
  sourceIp: string;
}

export function newRouteContext(path: string, request?: Request): RouteContext {
  return {
    requestId: randomUUID(),
    startedAt: Date.now(),
    path,
    sourceIp: request ? httpClientIpFrom(request) : "unknown",
  };
}

function emit(
  level: LogLevel,
  ctx: RouteContext,
  status: number,
  extra: LogFields,
): void {
  log(level, {
    request_id: ctx.requestId,
    path: ctx.path,
    status,
    latency_ms: Date.now() - ctx.startedAt,
    ...extra,
  });
}

/** 401 with byte-identical body across all auth-failure branches. */
export function unauthorized(
  ctx: RouteContext,
  extra: LogFields = {},
): Response {
  emit("warn", ctx, 401, { error_slug: "unauthorized", ...extra });
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export function jsonError(
  ctx: RouteContext,
  status: number,
  slug: string,
  init: { message?: string; level?: LogLevel; extra?: LogFields } = {},
): Response {
  emit(init.level ?? "warn", ctx, status, { error_slug: slug, ...init.extra });
  const body: Record<string, unknown> = {
    error: slug,
    request_id: ctx.requestId,
  };
  if (init.message) body.message = init.message;
  return Response.json(body, { status });
}

export function jsonOk<T>(
  ctx: RouteContext,
  body: T,
  init: { status?: number; extra?: LogFields; headers?: HeadersInit } = {},
): Response {
  const status = init.status ?? 200;
  emit("info", ctx, status, init.extra ?? {});
  return Response.json(body, { status, headers: init.headers });
}

export interface ResolvedOwner {
  ownerId: string;
  authType: "session" | "pat";
  /**
   * Pre-shaped log fields for routes to spread into their log calls. Saves
   * every call site from repeating `{ auth_type, owner_id }`.
   */
  logFields: Pick<LogFields, "auth_type" | "owner_id">;
}

/**
 * Resolve the owner id for an owner-management endpoint. Returns the id +
 * auth type, or a ready-to-return 401 response (with `auth_failure_reason`
 * already logged) if auth failed. Centralizing here means every owner
 * route logs auth failures the same way.
 */
export async function resolveOwner(
  request: Request,
  ctx: RouteContext,
): Promise<ResolvedOwner | { response: Response }> {
  const result = await ownerAuthFromRequest(request);
  if (!result.ok) {
    return {
      response: unauthorized(ctx, { auth_failure_reason: result.reason }),
    };
  }
  return {
    ownerId: result.data.ownerId,
    authType: result.data.authType,
    logFields: {
      auth_type: result.data.authType,
      owner_id: result.data.ownerId,
    },
  };
}

/**
 * Server-misconfig (503) for routes that need the API-key pepper. Owner
 * routes that mint or revoke credentials all need it; reading-only routes
 * don't.
 */
export function requirePepper(ctx: RouteContext):
  | { pepper: string }
  | { response: Response } {
  const pepper = process.env.BOTPLACE_API_KEY_PEPPER;
  if (!pepper) {
    return {
      response: jsonError(ctx, 503, "server_misconfigured", {
        level: "error",
      }),
    };
  }
  return { pepper };
}

/**
 * Per-owner rate limit on credential-management mutations. Routes that
 * mint or rotate credentials should call this immediately after
 * `resolveOwner`. On success returns `{ headers }` to merge into the
 * eventual success response. On rate-limit / unavailable, returns a
 * ready-to-return response.
 */
export async function applyOwnerWriteRateLimit(
  ctx: RouteContext,
  owner: ResolvedOwner,
): Promise<{ headers: Record<string, string> } | { response: Response }> {
  const rl = await checkOwnerWriteRateLimit(owner.ownerId);
  if (!rl.ok) {
    if (rl.reason === "rate_limit_unavailable") {
      return {
        response: jsonError(ctx, 503, "rate_limit_unavailable", {
          level: "error",
          extra: { ...owner.logFields, dependency: "upstash" },
        }),
      };
    }
    log("warn", {
      request_id: ctx.requestId,
      path: ctx.path,
      status: 429,
      error_slug: "rate_limited",
      rate_limit_scope: "owner_write",
      ...owner.logFields,
      latency_ms: Date.now() - ctx.startedAt,
    });
    return {
      response: Response.json(
        {
          error: "rate_limited",
          scope: rl.scope,
          request_id: ctx.requestId,
        },
        {
          status: 429,
          headers: ownerWriteRateLimitHeaders(
            rl.ownerWrite,
            rl.retryAfterSeconds,
          ),
        },
      ),
    };
  }
  return { headers: ownerWriteRateLimitHeaders(rl.ownerWrite) };
}

/**
 * Shape `{ name: string }` body, returning trimmed name or null. Null
 * covers: missing body, non-object body, non-string `name`, empty after
 * trim, or length > MAX_NAME_LENGTH. Callers report a single
 * invalid_input error covering all those cases.
 */
export async function readNameBody(request: Request): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as
    | { name?: unknown }
    | null;
  if (!body || typeof body !== "object") return null;
  if (typeof body.name !== "string") return null;
  const trimmed = body.name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return null;
  return trimmed;
}

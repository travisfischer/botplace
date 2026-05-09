// Route-handler helpers for the owner-management API. Centralizes the
// boilerplate every owner endpoint needs: request id, structured logging,
// auth resolution, and uniformly-shaped error/success bodies.
//
// Use from any handler under `app/api/v1/bots/...` or `app/api/v1/owner/...`.
// The pixel-write and read endpoints predate this helper and have their
// own (slightly different) logging shape; don't try to unify them yet.

import { randomUUID } from "node:crypto";

import { ownerIdFromRequest } from "@/src/auth/authenticate";
import { log, type LogFields, type LogLevel } from "./log";

export interface RouteContext {
  requestId: string;
  startedAt: number;
  path: string;
}

export function newRouteContext(path: string): RouteContext {
  return { requestId: randomUUID(), startedAt: Date.now(), path };
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

/**
 * Resolve the owner id for an owner-management endpoint. Returns the id, or
 * a ready-to-return 401 response if auth failed. Centralizing here means
 * every owner route logs auth failures the same way.
 */
export async function resolveOwner(
  request: Request,
  ctx: RouteContext,
): Promise<{ ownerId: string } | { response: Response }> {
  const ownerId = await ownerIdFromRequest(request);
  if (!ownerId) return { response: unauthorized(ctx) };
  return { ownerId };
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

/** Shape `{ name: string }` body, returning trimmed name or null. */
export async function readNameBody(request: Request): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as
    | { name?: unknown }
    | null;
  if (!body || typeof body !== "object") return null;
  if (typeof body.name !== "string") return null;
  const trimmed = body.name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Minimal structured logger. One JSON line per event, written to console —
// Vercel + tail-anything can consume this without infra. The field set is
// fixed by the M1 NFR (B7); add new fields with care since M4 dashboards
// will depend on stability.
//
// No PII, no plaintext credentials. The `auth_failure_reason` field is
// internal-only — it never appears in HTTP response bodies.

export type LogLevel = "info" | "warn" | "error";

export type AuthFailureReason =
  | "missing_header"
  | "malformed_header"
  | "unknown_key"
  | "revoked_key"
  | "revoked_bot"
  | "wrong_credential_type"
  | "server_misconfigured";

export type AuthType =
  | "session"
  | "pat"
  | "bot_key"
  | "admin_token"
  | "public";

export interface LogFields {
  request_id?: string;
  /**
   * Upstream request id propagated via the `X-Botplace-Parent-Request-Id`
   * header. Used by the M2.5 cron-driven launch bots so an operator can
   * pivot from a cron-tick log line to the `/api/v1/pixels` log line it
   * generated.
   */
  parent_request_id?: string;
  path?: string;
  status?: number;
  error_slug?: string;
  auth_failure_reason?: AuthFailureReason;
  /**
   * Which credential class authenticated the request, when one did. Lets
   * operators attribute traffic to humans (`session`), agent-as-owner
   * (`pat`), bots (`bot_key`), or admin tooling (`admin_token`) without
   * inferring from path or body shape.
   */
  auth_type?: AuthType;
  bot_id?: string;
  owner_id?: string;
  sector_id?: string;
  rate_limit_scope?: "bot" | "ip" | "read" | "owner_write" | "public_read";
  latency_ms?: number;
  /** BigInt serialized as string — JSON.stringify can't encode BigInt directly. */
  chunk_version_after?: string;
  dependency?: "upstash" | "neon";
  [key: string]: unknown;
}

// JSON.stringify replacer: BigInt → string. Without this, a stray BigInt
// in the log fields throws and kills the request.
function safeReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function log(level: LogLevel, fields: LogFields): void {
  let line: string;
  try {
    line = JSON.stringify(
      { level, ts: new Date().toISOString(), ...fields },
      safeReplacer,
    );
  } catch (err) {
    // Don't lose the line entirely — emit a degraded JSON shape so the
    // log stream still has something for the request.
    line = JSON.stringify({
      level: "error",
      ts: new Date().toISOString(),
      error_slug: "log_serialization_failed",
      error_class: err instanceof Error ? err.constructor.name : "unknown",
      request_id: typeof fields.request_id === "string" ? fields.request_id : undefined,
    });
  }
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

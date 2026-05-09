// Tagged result type for the auth resolvers. Lets every caller distinguish
// "auth failed" from "auth succeeded with these claims" in a way that's
// exhaustive at the type level — and lets the route layer log the *reason*
// the auth failed via the structured-log `auth_failure_reason` field, even
// while every 401 body remains byte-identical per the M1 NFR.

import type { AuthFailureReason } from "@/lib/log";

export type AuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: AuthFailureReason };

export const authOk = <T>(data: T): AuthResult<T> => ({ ok: true, data });
export const authFail = (reason: AuthFailureReason): AuthResult<never> => ({
  ok: false,
  reason,
});

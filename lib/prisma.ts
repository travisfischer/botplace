import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Normalize the `sslmode` query parameter in the connection string to
 * `verify-full`. We do this for two reasons:
 *
 * 1. The `pg` driver currently treats `require` / `prefer` / `verify-ca`
 *    as aliases for `verify-full` (encrypt + verify cert chain + verify
 *    hostname). In `pg` v9 / `pg-connection-string` v3, those modes
 *    will adopt libpq's traditional semantics — encrypt only, no cert
 *    verification — which would be a silent security regression on
 *    every Neon / Vercel-injected URL.
 * 2. Neon's API returns `sslmode=require` by default; Vercel↔Neon
 *    injects the same. Forcing `verify-full` at the application
 *    boundary fixes dev + prod + preview without depending on the
 *    upstream defaults changing.
 *
 * Neon serves a valid public-CA cert, so `verify-full` works on every
 * connection mode (pooled, unpooled, direct). If a future caller hits
 * a host where strict cert checking isn't possible, they can override
 * the URL explicitly.
 */
function normalizeSslMode(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("sslmode", "verify-full");
    return url.toString();
  } catch {
    // Not a parseable URL — let pg surface its own error rather than
    // swallowing a malformed connection string here.
    return rawUrl;
  }
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: normalizeSslMode(process.env.DATABASE_URL),
    }),
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error", "warn"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

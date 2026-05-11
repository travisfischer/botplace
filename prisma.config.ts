import "dotenv/config";
import { defineConfig } from "prisma/config";

// Mirror of lib/prisma.ts § normalizeSslMode. Force sslmode=verify-full so
// `pg` v9's planned semantics change (where `require` → encrypt-only) does
// not silently relax our migration-time security posture. Neon serves a
// public-CA cert, so verify-full works on every connection mode.
function normalizeSslMode(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("sslmode", "verify-full");
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations need an unpooled connection (DDL through pgbouncer
    // transaction pooling is fragile). Prefer an explicit DIRECT_URL,
    // then Neon's native-integration name (DATABASE_URL_UNPOOLED), and
    // fall back to DATABASE_URL only as a last resort.
    url: normalizeSslMode(
      process.env.DIRECT_URL ??
        process.env.DATABASE_URL_UNPOOLED ??
        process.env.DATABASE_URL,
    ),
  },
});

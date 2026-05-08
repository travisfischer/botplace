import "dotenv/config";
import { defineConfig } from "prisma/config";

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
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL,
  },
});

# Local development setup

Get a clone of this repo running locally with a working dev server, a connected Postgres, and applied migrations.

## Stack

- **Runtime:** Node.js 24.x (pinned via `.nvmrc` and `engines.node`)
- **Web framework:** Next.js 16 (App Router) + React 19 + TypeScript
- **Package manager:** pnpm 11 (via corepack)
- **Database:** PostgreSQL (Neon in production and previews; any local Postgres works for dev)
- **Migration / ORM:** Prisma 7 with the `@prisma/adapter-pg` driver adapter
- **Deploy target:** Vercel (using the Node 24.x function runtime)

## Prerequisites

- Node.js **24.x** — Prisma 7 requires `20.19+` / `22.12+` / `24.0+`, and we standardize on 24 to match the Vercel runtime. The repo pins this via `.nvmrc` and `engines.node`.
- [Corepack](https://nodejs.org/api/corepack.html) (ships with Node; enable once with `corepack enable`)
- [1Password CLI](https://developer.1password.com/docs/cli/) (`op`) signed in — see [secrets.md](secrets.md)
- A Postgres connection string. Easiest option: a Neon project's "development" branch URL.

### Getting Node 24

Pick whichever version manager you prefer. The project ships `.nvmrc` and `.node-version` with `24`, so any of these will pick up the right version automatically:

- **fnm** (recommended): `brew install fnm` then `fnm install` from the repo root.
- **nvm**: `nvm install` from the repo root.
- **Homebrew direct**: `brew install node@24` and either `brew link --force node@24` or add `/opt/homebrew/opt/node@24/bin` to your `PATH`.

Verify with `node -v` — it should print `v24.x.x`.

## First-time install

```bash
corepack enable
pnpm install
```

`pnpm install` runs `prisma generate` via `postinstall`, which writes the TypeScript-native Prisma client into `generated/prisma/` (gitignored).

## Environment variables

Two files are involved depending on who reads them:

- **`.env.local`** — read by the Next.js dev server.
- **`.env`** — read by the Prisma CLI (Prisma 7's `prisma.config.ts` calls `dotenv/config`, which loads `.env`).

For local dev, set the same values in both files. Minimum:

```
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
DIRECT_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
```

- `DATABASE_URL` — runtime connection used by `lib/prisma.ts` via the `@prisma/adapter-pg` adapter. Use Neon's pooled URL (host ends with `-pooler`) in production. For local dev, the unpooled URL is fine.
- `DIRECT_URL` — used by `prisma.config.ts` for migrations. Always the unpooled URL. For local dev you can set both vars to the same string.

Both files are gitignored. Do not commit secrets.

## Run the dev server

```bash
pnpm dev
```

Then open <http://localhost:3000>. The health endpoint is at <http://localhost:3000/api/health> — it should return `{"status":"ok","db":"ok"}` when the DB is reachable.

## Database migrations

The repo ships with one empty initial migration in `prisma/migrations/`. To apply migrations to a fresh database:

```bash
pnpm db:migrate:deploy
```

This is idempotent — re-running it on an already-migrated DB does nothing.

When adding new schema models (Milestone 1+):

```bash
pnpm db:migrate:dev --name <change-name>
```

Prisma will diff the schema, generate a new migration file, and apply it to your local DB.

To regenerate the Prisma client after editing the schema without creating a migration:

```bash
pnpm db:generate
```

## Connecting to Neon for local dev

There are two practical options:

1. **Use a personal Neon branch.** In the Neon console, branch off the `main` branch and use that branch's connection string in `.env.local`. Reset the branch when you want a clean slate.
2. **Run Postgres locally** (e.g., via `brew install postgresql` or `docker run postgres`). Migrations and the app will work against any Postgres 14+; only Neon-specific features (branching, autoscaling) are unavailable.

## Useful scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the Next.js dev server |
| `pnpm build` | Production build (no DB migration) |
| `pnpm vercel-build` | Production build *plus* `prisma migrate deploy` (what Vercel runs) |
| `pnpm start` | Run a built production server |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run `tsc --noEmit` |
| `pnpm db:generate` | Regenerate the Prisma client |
| `pnpm db:migrate:dev` | Create + apply a new migration in dev |
| `pnpm db:migrate:deploy` | Apply pending migrations (used in CI/Vercel) |

## Verifying the setup

After `pnpm install` and a working `.env.local`:

```bash
pnpm db:migrate:deploy      # applies the empty init migration
pnpm dev                    # start the server
curl localhost:3000/api/health
# expect: {"status":"ok","db":"ok"}
```

If `/api/health` returns `503` with `{"status":"error","db":"error"}`, the app cannot reach Postgres. Check `DATABASE_URL`, network access to your DB host, and the Next.js dev server logs for the underlying Prisma error.

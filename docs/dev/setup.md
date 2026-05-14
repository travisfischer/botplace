# Local development setup

Get a clone of this repo running locally with a working dev server, a connected Postgres, and applied migrations.

## Quickstart (local-streaming setup, with 1Password)

This is the default path for a human developer running Botplace on a laptop. It uses 1Password CLI (`op`) to source long-lived secrets (Neon API key, Google OAuth secret, admin token) into process env on each command, leaving disposable per-branch values in `.env`.

```bash
# One-time machine setup
brew install fnm 1password-cli
corepack enable
fnm install                  # picks up .nvmrc → Node 24
eval $(op signin)            # sign in to 1Password

# One-time repo setup
pnpm install
pnpm op db:bootstrap         # creates a Neon dev branch, writes .env, runs migrations

# Daily
pnpm op dev                  # start the dev server with secrets in process env
```

Then open <http://localhost:3000>. The viewer loads `sector-1` (which will be empty in your dev branch until you write some pixels).

**Why `pnpm op` in front of everything?** It's a thin wrapper that runs `op run --env-file=op.env -- pnpm <script>`, which pulls the secrets named in [`op.env`](../../op.env) from 1Password and injects them into the process env of the inner command. The wrapper script is at `scripts/env/op-run.sh`. Using it consistently means you never have to remember which commands need which secrets.

Plain `pnpm <cmd>` still works for things that don't need process-env secrets (e.g. `pnpm lint`, `pnpm test`, `pnpm typecheck`). When in doubt, prefix with `pnpm op` — it's a no-op for scripts that don't read the env vars it injects.

For the rare case where you need to wrap a non-pnpm command with 1Password secrets, fall through to direct `op run`:

```bash
op run --env-file=op.env -- <any-command>
```

## Quickstart (cloud-agent setup, no 1Password)

For coding agents running in a cloud sandbox, your platform injects long-lived secrets into process env directly (e.g. via `NEON_API_KEY` and `NEON_PROJECT_ID` set as platform secrets on the agent). You skip the `op` step:

```bash
# Process env already populated by the agent platform
corepack enable
pnpm install
pnpm db:bootstrap                 # no `op` prefix — secrets are already in env
pnpm dev
```

The `pnpm <cmd>` form is the same as the local-streaming path's inner command — just without the `pnpm op` wrapper. Everything beyond bootstrap (`pnpm test`, `pnpm dev`, etc.) is identical between the two setups.

## Which commands need process-env secrets?

| Command | `.env` is enough? | Needs in process env | Sourced from |
|---|---|---|---|
| `pnpm install` | yes | — | — |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | yes | — | — |
| `pnpm dev` (browse anonymously) | yes | — | — |
| `pnpm dev` (sign in via Google) | no | `GOOGLE_CLIENT_SECRET` | `op.env` → 1Password |
| `pnpm db:bootstrap`, `pnpm db:branch:cleanup` | no | `NEON_API_KEY`, `NEON_PROJECT_ID` | `op.env` → 1Password |
| `pnpm db:migrate:dev`, `pnpm db:migrate:deploy`, `pnpm db:check` | yes | — | `.env` (`DATABASE_URL_UNPOOLED`) |
| `pnpm admin:*` | no | `ADMIN_TOKEN` (+ `BOTPLACE_URL` for non-localhost) | `op.env` → 1Password |
| `pnpm bot:*`, `pnpm pat:*` | yes | `BOTPLACE_PAT` (after you mint one via the UI) | shell export, not in op.env |

In the local-streaming setup, just run `pnpm op <cmd>` for any row marked "no" in the second column. In the cloud-agent setup, the platform's already injected those env vars, so `pnpm <cmd>` is enough.

Run `pnpm op env:check` to confirm everything resolves correctly — it reports which env vars are present by name, never by value.

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
- For production-only ops scripts (e.g. the M2.5 launch-bots probe): [Vercel CLI](https://vercel.com/docs/cli) (`vercel`) and the GitHub CLI (`gh`). Not needed for day-to-day dev.

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

Botplace uses one canonical local env file: **`.env`** at the repo root. Both `lib/prisma.ts` (Next.js runtime, via `process.env`) and `prisma.config.ts` (Prisma CLI, via `dotenv/config`) read it. Don't introduce `.env.local` for local dev — it shadows `.env` for Next.js but is invisible to Prisma, which silently splits the two toolchains.

`.env` is generated by `pnpm db:bootstrap` (see below). Its allowed contents are documented in [secrets.md](secrets.md#allow--deny-list-for-the-local-env). A minimal hand-rolled `.env` for personal experimentation looks like:

```
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
NEON_BRANCH_NAME="dev-personal"
# Optional — only needed for Google sign-in during dev:
# GOOGLE_CLIENT_ID="<oauth client id>"
```

- `DATABASE_URL` — runtime connection used by `lib/prisma.ts` via the `@prisma/adapter-pg` adapter. In production this is Neon's pooled URL (host ends with `-pooler`); for local dev pooled or unpooled both work.
- `DATABASE_URL_UNPOOLED` — used by `prisma.config.ts` for migrations. Always the unpooled URL. Matches the name the Vercel↔Neon integration injects. `prisma.config.ts` also accepts a legacy `DIRECT_URL` for parity with older tooling.
- `NEON_BRANCH_NAME` — informational; lets scripts (e.g. the `pnpm db:migrate:dev` guard) name the branch they're touching.

Long-lived automation credentials (`NEON_API_KEY`, `VERCEL_TOKEN`, provider keys) **never** belong in `.env`. They live in process env, populated by your shell, a cloud-agent platform secret, or `op run`. See [secrets.md](secrets.md) for the full allow/deny list and source-of-truth table.

`.env` is gitignored. Run `pnpm env:check` to verify presence by name without printing values.

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

When changing schema models, generate a fresh migration against your dev branch:

```bash
pnpm db:migrate:dev --name <change-name>
```

Prisma will diff the schema, generate a new migration file, and apply it to your local DB.

To regenerate the Prisma client after editing the schema without creating a migration:

```bash
pnpm db:generate
```

## Connecting to Neon for local dev

The recommended path is a hosted Neon dev branch off the shared `dev-main` baseline. With `NEON_API_KEY` and `NEON_PROJECT_ID` in your process env:

```bash
# Local-streaming setup (1Password):
pnpm op db:bootstrap

# Cloud-agent setup (platform already injected NEON_*):
pnpm db:bootstrap
```

That creates (or reuses) a `dev-<random>` child branch off `dev-main`, writes `.env` from the allow list (Neon connection URIs, `BOTPLACE_API_KEY_PEPPER`, `AUTH_SECRET`, and — when present in process env — `GOOGLE_CLIENT_ID`), runs `prisma migrate deploy`, and prints DB-OK status. Re-running it is idempotent.

If you'd rather not use Neon — for example, offline work — you can run Postgres locally (`brew install postgresql` or `docker run postgres`) and hand-author `.env`. Migrations and the app work against any Postgres 17+; Neon-specific features (branching, autoscale) are off the table on local Postgres.

## Rate limiting in dev

Production uses Upstash Redis for rate limiting. Local dev has **no Upstash dependency**: `lib/rate-limit.ts` falls back to an in-process memory bucket when no Upstash env (`UPSTASH_REDIS_REST_URL`/`KV_REST_API_URL` + token) is set and `NODE_ENV !== 'production'`. This is a deliberate dev-experience choice — the disposable per-Neon-branch dev story shouldn't require an extra service to run a local server. The fallback resets on every dev-server restart, so testing rate-limit behavior across processes still requires real Upstash creds in your env.

### Fetching the Upstash creds when you do need them

Upstash is installed via the **Vercel Marketplace integration**, so the credentials are managed by Vercel — not stored in 1Password (see [secrets.md](secrets.md#items)). To exercise real Upstash from a dev session:

1. Open the Vercel dashboard → your project → **Storage** tab → the Redis store.
2. Find `KV_REST_API_URL` and `KV_REST_API_TOKEN` in the env-vars section; click "Show secret" to reveal the token.
3. Export them into your current shell for the session:

   ```bash
   read -p "Paste KV_REST_API_URL: "      KV_REST_API_URL
   read -s -p "Paste KV_REST_API_TOKEN: " KV_REST_API_TOKEN; echo
   export KV_REST_API_URL KV_REST_API_TOKEN
   pnpm dev
   ```

4. When you're done, `unset KV_REST_API_URL KV_REST_API_TOKEN` (or just close the terminal). Never paste these into `.env` — the integration rotates them and a stale local copy is a worse bug than re-fetching on demand.

Heads up: `vercel env pull --environment=production` is **not** a reliable path for these. Vercel masks any env var marked sensitive (which `KV_REST_API_TOKEN` is by default) with `***`, so the resulting file contains placeholder strings instead of working credentials. Use the Storage UI instead.

## Useful scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the Next.js dev server |
| `pnpm build` | Production build (no DB migration) |
| `pnpm vercel-build` | Production build *plus* `prisma migrate deploy` (what Vercel runs) |
| `pnpm start` | Run a built production server |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run `tsc --noEmit` |
| `pnpm env:check` | Report required env-var presence by name; exits non-zero if any required input is missing |
| `pnpm op <pnpm-script>` | Run a pnpm script with 1Password-sourced secrets via `op run --env-file=op.env -- pnpm <script>`. Use this in local-streaming setup; cloud-agent setups skip it because the platform injects env directly |
| `pnpm db:bootstrap` | Create or reuse a Neon dev branch off `dev-main`, write `.env`, run migrations |
| `pnpm db:check` | Standalone DB connectivity health check (no Next.js dev server required) |
| `pnpm db:branch:cleanup` | Delete disposable `dev-<random>` Neon branches (protects `main`, `dev-main`, and the branch in your current `.env`). `--dry-run` to preview, `--yes` to skip the prompt |
| `pnpm db:generate` | Regenerate the Prisma client |
| `pnpm db:migrate:dev` | Create + apply a new migration in dev (refuses to run on `dev-main` or production) |
| `pnpm db:migrate:deploy` | Apply pending migrations (used in CI/Vercel) |
| `pnpm admin:set-bot-tier <bot-id> <FREE\|POWER>` | Set a bot's rate tier via `PUT /api/v1/admin/bots/:id/tier`. Needs `ADMIN_TOKEN` in process env |
| `pnpm m25:seed-launch-bots --owner-email <email>` | One-time provisioning of the three M2.5 launch bots (`m25-visitor-pulse`, `m25-sparkle`, `m25-conway`) at POWER tier. Idempotent. See [`docs/dev/probes/m2.5-launch-bots.md`](probes/m2.5-launch-bots.md) for the full rollout |

## Verifying the setup

After `pnpm install` and a working `.env`:

```bash
pnpm env:check              # confirms required vars are present (by name only)
pnpm db:check               # confirms DB connectivity
pnpm dev                    # start the server
curl localhost:3000/api/health
# expect: {"status":"ok","db":"ok"}
```

If `/api/health` returns `503` with `{"status":"error","db":"error"}`, the app cannot reach Postgres. Check `DATABASE_URL`, network access to your DB host, and the Next.js dev server logs for the underlying Prisma error.

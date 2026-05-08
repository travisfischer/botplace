# Deploy and provisioning

How to take the local skeleton from "runs on my machine" to "running at <https://botplace.app>". This is a one-time setup runbook for Milestone 0.

## Targets

- **Hosting:** Vercel project linked to `github.com/travisfischer/botplace`.
- **Database:** Neon Postgres, with per-PR branches via the Vercel↔Neon integration.
- **DNS:** Cloudflare-managed `botplace.app` pointing apex + `www` to Vercel.

## 1. Create the Vercel project

1. In the [Vercel dashboard](https://vercel.com/new), import `github.com/travisfischer/botplace`.
2. Framework preset: **Next.js** (auto-detected).
3. Build command: leave default — Vercel will pick up the `vercel-build` script from `package.json`, which runs `prisma generate && prisma migrate deploy && next build`.
4. Install command: leave default (`pnpm install`).
5. Output directory: leave default.
6. **Node.js version**: under **Project → Settings → General**, set the Node.js version to **24.x**. The repo's `package.json` declares `"engines": { "node": ">=24.0.0" }`, but Vercel's project setting controls the function runtime — keep them aligned to avoid surprises.
7. Do **not** set environment variables yet — the Neon integration adds them in step 2.
8. Click **Deploy**. The first deploy will fail because there is no database; that is expected.

## 2. Provision Neon and wire the Vercel↔Neon integration

1. In the Vercel project, open **Storage → Marketplace → Neon** and add a new Neon database.
2. Choose a region close to your primary user base (US-East is a sensible default).
3. Accept the integration's defaults. It will:
   - Create a Neon project for Botplace.
   - Create a `production` branch.
   - Inject `DATABASE_URL` (pooled) and `DIRECT_URL` (unpooled) into the Vercel project's env vars.
4. **Enable per-PR Neon branches**: in the Neon dashboard, open the Vercel integration settings and turn on "Create a new branch for each preview deployment." Confirm that preview deployments will also receive scoped `DATABASE_URL` / `DIRECT_URL` values.
5. Trigger a new deploy from Vercel (push an empty commit or use **Redeploy**). The build should now succeed: `prisma migrate deploy` runs against the Neon production branch and applies the empty init migration, then `next build` produces the app.

After this step, Vercel's deployment URL (e.g., `botplace-xyz.vercel.app`) should serve the Botplace placeholder page, and `/api/health` should return `{"status":"ok","db":"ok"}`.

## 3. Wire `botplace.app` via Cloudflare DNS

Vercel will tell you the apex `A` record IP and the `www` `CNAME` target.

In Cloudflare, for the `botplace.app` zone:

1. Add an **A** record for `botplace.app` (apex) → `76.76.21.21` (Vercel's anycast IP; verify against Vercel's "Add Domain" UI in case it has changed).
2. Add a **CNAME** record for `www.botplace.app` → `cname.vercel-dns.com.`
3. Set proxy status to **DNS only** (grey cloud) for both records — Vercel handles its own TLS. Cloudflare proxying conflicts with Vercel's edge network and is not needed.
4. In Vercel, under **Project → Settings → Domains**, add `botplace.app` and `www.botplace.app`. Set one as the canonical and the other as a redirect (typical: apex canonical, `www` redirects).
5. Wait for Vercel to verify and provision certificates (usually under five minutes).

At this point:

- <https://botplace.app> serves the placeholder page.
- <https://www.botplace.app> redirects to <https://botplace.app> (or vice versa, depending on your canonical choice).
- <https://botplace.app/api/health> returns `200` with `{"status":"ok","db":"ok"}`.

## 4. Verify the deploy

Smoke-test all four URLs after the first production deploy:

- <https://botplace.app>
- <https://www.botplace.app>
- <https://botplace.app/api/health>
- The latest preview URL from an open PR (Vercel posts a comment with the URL).

For the preview, also confirm `/api/health` on that URL returns DB-ok — that proves per-PR Neon branching is wired correctly.

## 5. Rollback / damage control

- **DB outage**: `prisma migrate deploy` and the runtime adapter both fail loudly. `/api/health` returns 503. Revert by fixing the Neon connection or rolling the broken Vercel deploy back.
- **Bad migration**: re-run with a corrective migration. Do not edit the migration history; add a new `pnpm db:migrate:dev --name fix-...` migration and deploy.
- **DNS misconfig**: revert the DNS change in Cloudflare. The previous Vercel deployment URL is still serving traffic.

## 6. Secrets recap

After provisioning, the live runtime depends on:

- `DATABASE_URL` and `DIRECT_URL` — managed automatically by the Vercel↔Neon integration. Do not set these manually in `Vercel → Settings → Environment Variables` unless you are intentionally overriding the integration.

Local dev keeps the same names in `.env.local` (see [setup.md](setup.md)).

CLI access (provisioning, debugging) uses 1Password references documented in [secrets.md](secrets.md).

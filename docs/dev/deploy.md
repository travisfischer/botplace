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
2. Choose a region close to your primary user base (US-East / `pdx1` are sensible defaults).
3. Accept the integration's defaults to create the Neon project + a production branch.
4. **Configure deployment branching for the project connection** — labelled differently than older docs imply:
   - In Vercel, open **Storage → `<your Neon database>` → Projects** (left sidebar).
   - On the connected `botplace` row, click the kebab `⋯` → **Update Project Connection**.
   - In the **Configure botplace** modal, ensure:
     - **Environments**: Production, Preview.
     - **Require Active Resource Before Deploy**: on (so previews wait for the Neon branch to be ready).
     - **Create Database Branch For Deployment**: both **Preview** and **Production** checked. The Preview checkbox is the per-PR-branches toggle.
     - **Custom Environment Variable Prefix**: leave empty so the canonical `DATABASE_URL` / `DATABASE_URL_UNPOOLED` names are injected.
   - Click **Save Changes**.
5. The integration injects (no prefix): `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (unpooled / used for migrations), plus assorted `POSTGRES_*` and `PG*` aliases for tools that expect them. With Preview branching on, these vars are injected per-deployment for each PR, scoped to a freshly-created Neon branch.
6. Trigger a new deploy (push an empty commit or use **Redeploy**). The build should succeed: `prisma migrate deploy` runs against the appropriate Neon branch via `DATABASE_URL_UNPOOLED`, applies any pending migrations, then `next build` produces the app.

After this step, Vercel's deployment URL (e.g., `botplace-xyz.vercel.app`) should serve the Botplace placeholder page, and `/api/health` should return `{"status":"ok","db":"ok"}`. PR preview deploys should do the same against a per-PR Neon branch — check the build logs to confirm the injected `DATABASE_URL` hostname differs from production.

## 3. Wire `botplace.app` via Cloudflare DNS

In **Vercel → Project → Settings → Domains**, click **Add Existing** and enter `botplace.app`. Vercel auto-creates both `botplace.app` (apex) and `www.botplace.app`, and sets one as canonical with the other 307-redirecting to it. Inside the **Manual setup** tab on each domain, Vercel shows the *exact* DNS records it expects — a per-account target that looks like `<id>.vercel-dns-017.com.` (Vercel's newer IP-range-expansion convention).

In Cloudflare, for the `botplace.app` zone, copy those values verbatim:

1. **CNAME** at `@` (apex) → the per-account target Vercel showed (e.g. `<id>.vercel-dns-017.com.`). Cloudflare's CNAME flattening makes apex-CNAMEs work.
2. **CNAME** at `www` → the same per-account target.
3. Both records: **DNS only** (grey cloud). Vercel handles its own TLS and proxying; Cloudflare's orange cloud breaks Vercel's edge.

> Vercel's older A-record convention (`76.76.21.21` apex) and shared CNAME (`cname.vercel-dns.com`) still work, but Vercel's UI surfaces the per-account target as the recommended choice. Use whichever the dashboard prints — and use both records' values verbatim from Vercel.

DNS propagates within seconds on Cloudflare. Vercel auto-validates and provisions Let's Encrypt certificates within minutes.

At this point:

- <https://botplace.app> serves the placeholder page (or 307-redirects to `www`, depending on which you set canonical).
- <https://www.botplace.app> serves the placeholder page (mirror of the above).
- <https://botplace.app/api/health> returns `200` with `{"status":"ok","db":"ok"}`.

The Cloudflare DNS records can also be created via the Cloudflare REST API if you'd rather script it; an API token scoped to `Zone:DNS:Edit` on the zone is sufficient.

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

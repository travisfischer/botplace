---
date: 2026-05-07
shipped: 2026-05-07
type: feat
topic: milestone-0-skeleton-and-hosting
status: shipped
planning_depth: standard
---

# Requirement: Milestone 0 — Project Skeleton and Hosting

## Status

**Shipped 2026-05-07.** Live at <https://botplace.app> with `/api/health` returning DB-OK on production and per-PR previews. Landed in PR #1 (milestone-0 scaffold), with follow-ups in PR #2 (unpooled URL for migrations) and PR #3 (secrets-doc cleanup). Stack: Next.js 16 (App Router) + React 19 + TypeScript + Prisma 7 + `@prisma/adapter-pg`, on Vercel's Node 24 runtime, against Neon Postgres via the Vercel↔Neon integration with per-PR branches enabled. Cloudflare DNS apex + `www` wired via per-account `vercel-dns-017.com` CNAMEs. Provisioning runbook lives in [`docs/dev/deploy.md`](../../docs/dev/deploy.md).

## Problem / Outcome

Botplace exists today as design docs and a brainstorm. Before any gameplay can be built, the project needs a deployed hosted skeleton on `botplace.app` with production database connectivity, automated deploys on push, and documented secret/setup conventions. Without this baseline, every subsequent milestone (bot registration, pixel writes, viewer) is blocked on infrastructure decisions and one-off manual setup.

The desired outcome of this milestone is a public, boring, empty hosted application: nothing to do as a user, but everything in place for a developer or coding agent to start adding the bot/sector/pixel models in Milestone 1.

## Scope

### In Scope

- Lock in concrete stack choices (web framework, package manager, DB migration tool).
- Initialize the application skeleton in this repo.
- Provision Vercel project linked to `github.com/travisfischer/botplace`.
- Provision Neon Postgres database with a production branch and pooled connection URL.
- Wire `botplace.app` (apex and `www`) to the Vercel project via Cloudflare DNS, with HTTPS.
- Configure production deploys on push to `main` and preview deploys on PR.
- Add an empty initial database migration and have it run as part of deploy or be invokable on demand.
- Add a `/api/health` endpoint that returns 200 and confirms DB connectivity.
- Add minimal observability: structured server logs viewable in Vercel + the migration/health-check signal.
- Document the local dev setup, required environment variables, and 1Password secret references in `docs/dev/`.
- Add the new secret rows to `docs/dev/secrets.md` as they are introduced (Neon, Vercel, etc.).

### Out of Scope

- Anything bot-, sector-, pixel-, or palette-related (deferred to Milestone 1+).
- Public viewer / canvas UI beyond a placeholder landing page.
- Authentication of any kind (human or bot).
- Redis / rate limiting infrastructure (deferred to Milestone 1).
- Sentry or third-party error monitoring beyond Vercel built-in logs.
- Backup strategy, retention policy, multi-region failover (deferred to Milestone 4 — Operational Hardening).
- Custom CI beyond Vercel's built-in build (no separate GitHub Actions workflow yet).

## Requirements

### Functional Requirements

- [x] Repo contains an installable, runnable web app skeleton with `pnpm install && pnpm dev` (or chosen-equivalent) starting a local server.
- [x] `botplace.app` and `www.botplace.app` resolve to the deployed Vercel app over HTTPS.
- [x] Pushing to `main` triggers a Vercel production deploy that goes live at `botplace.app`.
- [x] Opening a pull request triggers a Vercel preview deploy with a unique URL.
- [x] Each PR preview deploy is wired to its own Neon database branch (via the Vercel↔Neon integration), so preview testing cannot mutate production data.
- [x] A `GET /api/health` endpoint returns `200 OK` with a JSON body that includes `{"status":"ok","db":"ok"}` (or equivalent shape) when the DB is reachable.
- [x] When the DB is unreachable, `/api/health` returns a non-200 status with a body indicating which dependency failed, so deploy health is observable.
- [x] The chosen migration tool can apply migrations against production Postgres via a documented command.
- [x] An empty initial migration exists in the repo and applies cleanly to a fresh database.
- [x] `docs/dev/setup.md` (new) exists and documents: stack choices, prerequisites, how to install, how to run locally, how to connect to a local or hosted Neon instance, and how to run migrations.
- [x] `docs/dev/secrets.md` includes rows for every new credential introduced (e.g., Neon connection string, Vercel API token if used, etc.).

### Non-Functional Requirements

- [x] Production secrets are stored in Vercel project env vars and referenced from 1Password (no plaintext secrets in repo or in commit history).
- [x] Cold-start `/api/health` p95 latency in production is under 2s (signals DB pooling is wired correctly).
- [x] The deployed app responds with `200 OK` from the apex (`botplace.app`) without redirect chains longer than one hop.
- [x] All chosen tools are still actively maintained and have documented Vercel/Neon integration paths.
- [x] No piece of the skeleton commits us to a UI framework or auth system that would block Milestone 1 swaps.

## Acceptance Criteria

- [x] Visiting `https://botplace.app` in a browser renders the deployed app's placeholder page with no console errors.
- [x] Visiting `https://botplace.app/api/health` returns `200` with `{"status":"ok","db":"ok"}` (or equivalent shape).
- [x] A draft PR opened against the repo gets a Vercel preview comment with a working URL whose `/api/health` endpoint also returns DB-ok.
- [x] A new contributor can clone the repo, follow `docs/dev/setup.md`, and reach a working `pnpm dev` (or equivalent) within ~15 minutes, including secret retrieval.
- [x] Running the documented migration command against an empty Postgres database completes without error and produces a `migrations` (or equivalent) tracking row.
- [x] `docs/dev/secrets.md` has a table row for every secret consumed by the deployed app or by the local dev flow.
- [x] Repo's `main` branch matches what is currently deployed at `botplace.app` (no drift).

## Risks and Mitigations

- **Cloudflare DNS → Vercel apex mapping friction.** Apex domains require an `A` or `ANAME`/flattened `CNAME` to Vercel; Cloudflare has its own CNAME flattening behavior that can interact awkwardly with Vercel's verification. *Mitigation:* follow Vercel's documented apex setup; if apex proves blocking, ship `www.botplace.app` first and add apex via redirect.
- **Neon connection-pool exhaustion under Vercel serverless cold starts.** Each cold function instance can open a fresh connection if the wrong URL is used. *Mitigation:* use Neon's pooled (`-pooler`) connection string for runtime; reserve the unpooled URL only for migration runs.
- **ORM gravity from Prisma.** Prisma is chosen for ergonomics and Vercel-stack fit, but its generated client tends to spread through the codebase and makes a future swap expensive. *Mitigation:* keep Prisma usage isolated behind a thin data-access layer in Milestone 1 so the query surface, not the migration files, is what we'd need to rewrite if we ever swap. Migrations are plain SQL and replayable against another tool.
- **Secret sprawl as more providers come online.** Every new vendor adds a credential. *Mitigation:* enforce the existing `op://Agents/<Service>/credential` convention from day one; every new secret gets a row in `docs/dev/secrets.md` in the same PR that introduces it.
- **Health-check that doesn't actually verify DB connectivity.** A health endpoint that always returns 200 hides outages. *Mitigation:* health-check must execute a trivial query (e.g., `SELECT 1`) and surface its result distinctly from "process is up."

## Dependencies

- Domain `botplace.app` is registered via Cloudflare Registrar (already done).
- Cloudflare API token in 1Password at `op://Agents/Cloudflare/credential` (already exists).
- GitHub repo `github.com/travisfischer/botplace` (already exists).
- Vercel account with permission to create a new project linked to GitHub.
- Neon account with permission to provision a new project.
- Decision on the Open Questions below before implementation starts.

## Validation Strategy

- Manual smoke test of all four URLs after deploy: `https://botplace.app`, `https://www.botplace.app`, `https://botplace.app/api/health`, and the latest preview URL.
- DB connectivity check: temporarily break the connection string in a preview deploy and confirm `/api/health` reports the failure with a non-200 status — then revert.
- Cold-start probe: hit `/api/health` after >5 minutes of idle and confirm latency stays under the 2s p95 bar.
- Setup doc walkthrough: do a clean `git clone` into a scratch directory, follow `docs/dev/setup.md` end-to-end, and note any step that requires tribal knowledge or undocumented secrets — fix gaps before closing the milestone.
- Migration replay: drop and recreate a scratch Neon database branch, run the documented migration command, and confirm a clean apply.

## Resolved Decisions

- **Framework choice.** Next.js (latest stable, App Router) + React (latest stable) + TypeScript. Vanilla Vercel-native stack; revisit if a future milestone justifies splitting workloads (e.g., a separate worker service for tick processing).
- **Migration tool.** Prisma. Travis is comfortable with it and it is the default in the Vercel/Next stack. Accept the ORM-gravity trade-off called out in Risks; if it bites later, migrations are still plain SQL we can replay against another tool.
- **Package manager.** `pnpm`. Vercel build command and `docs/dev/setup.md` should both standardize on it.
- **Landing-page content.** Minimal: a white page with the "Botplace" title. Cosmetic upgrades deferred.
- **Neon branching.** Per-PR Neon branches from day one, wired through the Vercel↔Neon integration so each preview deploy gets an isolated database. Migration runs on preview deploys must target the preview branch's connection string.
- **Logging surface.** Vercel's built-in function logs only. External sinks (Axiom/Logflare/Better Stack) deferred.

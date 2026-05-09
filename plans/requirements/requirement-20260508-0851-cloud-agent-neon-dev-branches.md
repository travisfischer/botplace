---
date: 2026-05-08
shipped: 2026-05-08
type: chore
topic: cloud-agent-neon-dev-branches
status: shipped
planning_depth: standard
---

# Requirement: Cloud-Agent-First Neon Dev Branch Workflow

## Status

**Shipped 2026-05-08.** Landed in PR #5 (`feat/cloud-agent-dev-workflow`). All scripts live under [`scripts/db/`](../../scripts/db/) and [`scripts/env/`](../../scripts/env/) and are exposed as `pnpm` scripts. The `dev-main` baseline branch is provisioned in Neon; bootstrap creates `dev-<8-hex>` children off it. `lib/prisma.ts` and `prisma.config.ts` both read the canonical `.env` (Next.js via `process.env`, Prisma CLI via `dotenv/config`). The migration guard reads `NEON_BRANCH_NAME` from process env first, then `.env`, and refuses both `main` and `dev-main` unless `NEON_ALLOW_BASELINE_MIGRATE=1`. Adapter remains `@prisma/adapter-pg` — TCP egress validated on the cloud-agent platforms in scope.

Followed up in commit `bcc46e8` with `pnpm db:branch:cleanup` (the "stale-branch cleanup" item from Possible Future Enhancements — now shipped, not future).

## Problem / Outcome

Botplace is built with cloud coding agents as a first-class development environment. The project already uses Neon Postgres, Prisma, and the Vercel↔Neon integration for deployed previews, but local/agent development still depends on hand-picking a Neon branch and copying connection strings into env files.

That manual flow is workable for one human; it is not a defensible default for repeatable agent work. A cloud agent should run one documented bootstrap and end up with an isolated, migrated, health-checked database branch — and should be unable to point a routine migration at production or a shared baseline by accident.

The desired outcome is a small, scriptable convention: hosted Neon dev branches as the default development DB path, a shared baseline branch off production, one disposable child branch per agent/task, and one canonical local env file that both Next.js and Prisma read.

## Scope

### In Scope

- Hosted Neon branches as the default development DB path for humans and cloud agents.
- A shared Neon baseline branch (`dev-main`) cloned off production and kept clean.
- A bootstrap command that creates or reuses a child branch off `dev-main`, runs migrations, and verifies DB connectivity.
- One canonical local env file (preferably `.env`) containing the disposable branch URLs and minimal branch metadata.
- Both `lib/prisma.ts` (Next.js runtime) and `prisma.config.ts` (Prisma CLI) reading the same canonical local env file.
- A migration guard that prevents `pnpm db:migrate:dev` from running against production or `dev-main` without an explicit maintenance flag.
- Setup docs covering both the cloud-agent path and a human local session.

### Out of Scope

- Docker / local Postgres as a first-class path.
- Dedicated integration-test branches.
- Automated stale-branch cleanup.
- Changes to Vercel preview/production deploy branching.
- Seed-data tooling, production-data import, or anonymization.
- Replacing Prisma or the Vercel↔Neon integration.

## Requirements

### Functional Requirements

- [x] One bootstrap command (e.g. `pnpm db:bootstrap`) creates or reuses a child branch off `dev-main`, materializes the canonical local env file, runs `prisma migrate deploy`, and prints DB-OK status.
- [x] Bootstrap is idempotent: if `NEON_BRANCH_NAME` already points at a non-baseline child branch, the same branch is reused and its connection URLs are refreshed.
- [x] Branch creation always parents off `dev-main`. The script refuses to parent off production.
- [x] Auto-generated branch names use a short random suffix, e.g. `dev-<8-char-random>`. Identity-in-the-name (per-agent or per-task tags) can come later.
- [x] Migration commands refuse to run against production or `dev-main` unless an explicit maintenance flag is passed.
- [x] `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) for the selected child branch are written to the canonical local env file. `NEON_BRANCH_NAME` is also written so any subsequent script can name what it is touching.
- [x] A standalone DB health-check command verifies connectivity without requiring `pnpm dev` to be running.
- [x] Setup docs include the happy path for both cloud agents and human local sessions.

### Non-Functional Requirements

- [x] Workflow is non-interactive once required env inputs are present.
- [x] Scripts fail fast with actionable messages when `NEON_API_KEY` or `NEON_PROJECT_ID` is missing or branch lookup fails.
- [x] Connection strings are masked or omitted from normal logs.
- [x] Implementation is small shell or TypeScript tooling — no long-lived service.

## Acceptance Criteria

- [x] From a fresh clone with `NEON_API_KEY` and `NEON_PROJECT_ID` present, `pnpm install && pnpm db:bootstrap` ends with a working canonical local env file and a passing DB health check.
- [x] `pnpm db:migrate:dev --name <change>` succeeds on the child branch.
- [x] The same migration command refuses to run when `NEON_BRANCH_NAME=dev-main` (or the production branch).
- [x] `pnpm dev` starts and `/api/health` returns `{"status":"ok","db":"ok"}` against the selected child branch.
- [x] Docs explicitly state that hosted Neon branches are the default DB path; Docker/local Postgres are listed as possible future enhancements only.

## Suggested Implementation Shape

Aim for a small surface area:

- Internal helper module (shell or TypeScript) for Neon API calls and env-file I/O, not exposed as a `pnpm` script.
- Three exposed `pnpm` scripts: `db:bootstrap`, `db:migrate:dev` (guard wrapper), `db:check`. Branch create / select live inside `db:bootstrap` rather than as separate scripts.
- One canonical local env file. `.env` is the recommended target — Next.js loads it, and `prisma.config.ts` already imports `dotenv/config`. If implementation lands on `.env.local` instead, `prisma.config.ts` must be updated to mirror Next's env-resolution order so both toolchains read the same values.
- Keep `@prisma/adapter-pg` as long as cloud-agent runtimes allow outbound Postgres TCP. Validate this assumption against the actual cloud-agent platforms we expect (e.g. Codex/Claude cloud) **before** finalizing the implementation; if any target platform restricts TCP egress, fall back to `@prisma/adapter-neon` (HTTP) for that path.

Prior art for the bootstrap/branch/migration-guard scripts exists in private repos outside Botplace. References are tracked in project memory rather than in this public-facing doc; adapt rather than copy verbatim — Botplace conventions differ in env-var naming and adapter choice.

Suggested package scripts:

```json
{
  "db:bootstrap": "scripts/db/bootstrap.sh",
  "db:migrate:dev": "scripts/db/migrate-dev-safe.sh",
  "db:migrate:deploy": "prisma migrate deploy",
  "db:check": "scripts/db/check-db.sh"
}
```

## Risks and Mitigations

- **Neon API credentials become a local prerequisite.** Adds one setup gate for both humans and agents. *Mitigation:* clear error messages naming exactly which env vars are required.
- **Agents accidentally mutate `dev-main`.** A shared baseline is only useful if normal work cannot casually write to it. *Mitigation:* both branch selection and migration commands reject `dev-main` unless an explicit, clearly-named maintenance flag is passed.
- **Env-file drift between `.env` and `.env.local`.** Prisma and Next.js can read different files if both are present. *Mitigation:* pick one canonical file; align both toolchains to read it.
- **Cloud-agent platforms may not allow outbound Postgres TCP.** Some cloud coding runtimes restrict to HTTP egress. *Mitigation:* validate TCP egress on each target platform during implementation; if any target fails, the fallback is `@prisma/adapter-neon` for that environment, kept behind a runtime flag so other paths stay simple.
- **Branch sprawl.** Per-agent branches accumulate. *Mitigation:* a consistent `dev-` prefix makes manual cleanup trivial; cleanup automation deferred to future enhancements.

## Dependencies

- Neon project already exists (provisioned via the Vercel↔Neon integration).
- A non-production baseline branch exists or can be created as `dev-main`.
- `NEON_API_KEY` and `NEON_PROJECT_ID` are available in process env (cloud-agent platform secrets, or local injection — see [env-and-secrets-mvp](requirement-20260508-0900-env-and-secrets-mvp.md)).
- Prisma config continues to read `DATABASE_URL_UNPOOLED` for migrations.

## Validation Strategy

- Run `pnpm db:bootstrap` from a clean clone; confirm Neon shows a child branch under `dev-main` and the canonical local env file contains the branch's connection URLs and `NEON_BRANCH_NAME`.
- Run `pnpm db:migrate:dev --name smoke-dev-branch` and confirm success.
- Set `NEON_BRANCH_NAME=dev-main` temporarily and confirm `pnpm db:migrate:dev` refuses to run.
- Run `pnpm dev` and confirm `/api/health` returns DB-OK against the child branch.

## Possible Future Enhancements

- Local Docker/Postgres fallback for offline development.
- Dedicated integration-test branch and reset script.
- ~~Stale-branch cleanup for old `dev-*` branches.~~ **Shipped** — see `pnpm db:branch:cleanup` ([`scripts/db/branch-cleanup.sh`](../../scripts/db/branch-cleanup.sh)).
- Branch-name identity tags (per-agent / per-task / per-PR).
- Seed-data snapshots for fast branch initialization.
- Neon HTTP-adapter path for cloud runtimes without TCP egress.

---
date: 2026-05-06
topic: mvp-scope-and-hosting
status: adopted
---

# Brainstorm: MVP Scope and Hosting

## Status (as of 2026-05-09)

The recommendations in this brainstorm were adopted and converted into requirements. Execution is well underway — Milestones 0 and 1 (plus M1 polish) are shipped; M2–M5 still pending.

**Shipped:**

- **Milestone 0 — Project Skeleton and Hosting** → [requirement](../requirements/requirement-20260507-0805-milestone-0-skeleton-and-hosting.md). Live at <https://botplace.app>. Stack landed exactly as Approach A recommended: Next.js 16 + React 19 + TypeScript on Vercel, Neon Postgres via the Vercel↔Neon integration with per-PR branches, Cloudflare DNS, Prisma 7 for migrations, pnpm 11.
- **Cloud-agent Neon dev-branch workflow** → [requirement](../requirements/requirement-20260508-0851-cloud-agent-neon-dev-branches.md). Hosted Neon dev branches as the default agent dev path; not anticipated in this brainstorm but slotted in before Milestone 1.
- **Env and secrets contract** → [requirement](../requirements/requirement-20260508-0900-env-and-secrets-mvp.md). Single canonical `.env`, Vercel as deploy source-of-truth, process env as the script interface, 1Password for human access.
- **Milestone 1 — Bot Registration, Pixel API, and Event Log** → [requirement](../requirements/requirement-20260508-1121-milestone-1-bot-registration-and-pixel-api.md). Auth.js v5 + Google OAuth, HMAC-SHA-256 + pepper credentials, lazy-allocated chunked canvas state, append-only `PixelEvent` log, Upstash token-bucket rate limiting (with in-process memory dev fallback), structured JSON logs, atomic key rotation, admin-revoke endpoint. End-to-end verified in prod.
- **M1 Polish — defense-in-depth, tests, CI, operator artifacts** → [requirement](../requirements/requirement-20260508-1900-m1-polish-and-defense-in-depth.md). Tagged auth resolvers, full credential-lifecycle audit trail, pixel-write-tx + auth-invariants tests, GitHub Actions CI, owner-mutation rate limits, `pnpm bot:*` / `pnpm pat:*` shell wrappers, admin doc, probe markdowns, `pnpm events:export`.

**Pending (Milestones 2–5):** no requirements docs yet. Public viewer (M2), bot DX (M3), ops hardening (M4), realtime decision (M5).

**Open questions resolved 2026-05-08** (see Resolved Decisions section below): Redis provider, palette selection method, bot registration identity, write semantics, and starter-bot format are all decided. The starter palette landed as DawnBringer's 8-color set in M1, with the registry slot for future tier rollouts captured but unbuilt.

## Problem / Opportunity

Botplace needs to move from design into a hosted, usable prototype without building the full AI-agent economy too early. The MVP should prove the core interaction: authenticated bots write pixels to shared sector canvases, humans can watch the result, and the system keeps enough history to replay, audit, and evolve into ownership, communication, and economy later.

The immediate product question is not "how do we build all of Botplace?" It is "what is the smallest hosted system that lets bots start making visible changes through an API while preserving the path to sectors, realtime updates, event logs, and future economic mechanics?"

## What We're Building

The MVP should be a hosted web application and API with:

- Public landing page and public canvas viewer.
- At least one 1000x1000 sector, with a data model that supports multiple sectors from day one.
- Bot registration and API-key authentication.
- REST endpoints for reading canvas state and writing pixel updates.
- Single-pixel and small batch pixel updates.
- Per-bot and per-IP rate limits.
- Durable append-only pixel update event log.
- Current canvas state optimized for reads.
- Minimal admin/operator controls for creating sectors, revoking bot keys, and changing rate limits.

The MVP should not include:

- Pixel ownership, buying, selling, leasing, currency, or upgrades.
- Bot forum or direct communication.
- Daily challenges or reputation UI.
- User-authored manual pixel painting.
- Custom bot hosting, unless needed as a later onboarding milestone.
- WebSocket fanout or CDN image diff frames in the first deploy, unless real usage demands it.

## Approaches Considered

### Approach A: Managed Full-Stack App on Vercel + Managed Postgres

Use a React/Next.js app hosted on Vercel, with API routes or server actions backed by managed Postgres. Store pixel events durably in Postgres and current sector state either as chunk rows in Postgres or a compact sector blob. Add Redis/Upstash later for rate limits and hot state if needed.

Pros:
- Fastest path to public URL and custom domain.
- Minimal infrastructure burden.
- Good fit for landing page, viewer, API docs, and basic REST endpoints.
- Easy deployment workflow and preview environments.
- Postgres event log gives a clean path to audit/replay and future economy tables.

Cons:
- Serverless API routes are not ideal for long-lived WebSockets.
- Hot pixel-write workloads can outgrow Postgres-only current-state storage.
- Rate limiting needs care because serverless instances are stateless.
- Realtime likely requires a separate service later.

### Approach B: Fly.io or Render App + Postgres + Redis

Run a small persistent Node/Go service on Fly.io or Render, backed by managed Postgres and Redis. Serve the frontend from the same app or from Vercel. Use Redis for rate limits and current hot canvas state, Postgres for durable event log and metadata.

Pros:
- Better fit for long-running workers and eventual WebSockets.
- Redis can naturally hold packed canvas state and rate-limit counters.
- Easier to add background workers for snapshots, replay, and future ticks.
- Less migration pain when moving from polling to realtime.

Cons:
- More infrastructure decisions upfront.
- Slightly slower first deploy than Vercel-only.
- More operational surface area.
- Requires more discipline around deployment, observability, and secrets.

### Approach C: Supabase-Centric App

Use Supabase for Postgres, auth, edge functions, storage, and realtime, with a frontend on Vercel or Supabase hosting. Use tables for bots, sectors, events, and possibly chunked canvas state.

Pros:
- Very fast to bootstrap auth, database, and admin views.
- Postgres-first model fits the future economy.
- Supabase realtime may cover early live viewer needs without custom WebSockets.
- Good developer experience for an MVP.

Cons:
- Supabase realtime is row/event-oriented, not purpose-built for high-frequency pixel fanout.
- Auth model may be more human-user-oriented than bot-key-oriented.
- Potential lock-in around edge functions and realtime semantics.
- May still need Redis or a custom service once write volume increases.

## Recommended Approach

Start with a managed web app plus managed Postgres, but draw the boundary as if a realtime service will be split out later.

Recommended initial hosting:

- Frontend and basic API: Vercel.
- Database: Neon Postgres.
- Rate limiting: managed Redis from the first public API milestone, with Upstash Redis as the default Vercel-native option unless provider consolidation argues for Redis Cloud.
- Custom domain: point the apex or `www` to Vercel.

This is the shortest credible path because the initial product needs public access, an API, durable records, and a viewer more than it needs a custom realtime backend. The architectural escape hatch is to keep pixel write handling behind a clear API boundary and store every accepted update in an append-only event log. If traffic grows, a dedicated Fly.io/Render service can take over write ingestion, Redis hot state, WebSockets, and snapshot generation without discarding the product model.

### Redis Provider Options

Vercel no longer offers Vercel KV for new projects; Redis is now connected through Marketplace providers. The practical choices are:

- Upstash Redis: strongest Vercel/serverless fit, REST-based SDK, easy environment variable integration, good enough for token-bucket rate limits.
- Redis Cloud: more traditional Redis provider, also available through the Vercel Marketplace, potentially better if we want a more canonical Redis vendor.
- Neon-only/Postgres-only rate limits: fewer providers, but not a good default because request-rate counters are a poor fit for the primary transactional database.

**Decision (2026-05-08): Upstash Redis for the MVP.** REST-based SDK is the right shape for serverless rate-limit counters on Vercel (no connection-pool drama on cold starts) and matches the existing Vercel-native posture. Hide it behind a small rate-limit module so moving to Redis Cloud later means changing one integration boundary, not product code.

## Proposed MVP Architecture

### Components

- Web app: landing page, public sector viewer, API docs, bot setup UI.
- REST API: bot auth, sector reads, single-pixel writes.
- Postgres: bots, API keys, sectors, current canvas chunks, pixel event log.
- Redis: per-bot and per-IP token buckets, optionally hot sector chunks later.
- Object storage/CDN later: generated snapshots or PNG frames if polling becomes too expensive.

### Human Accounts vs Bot Accounts

Botplace should remain bot-native, but the platform still needs an accountable owner for each bot. The design choice is whether that owner is represented as a full human account or as lighter-weight bot registration metadata.

Reasons to add human accounts:
- Users need to manage multiple bots from a dashboard.
- Users need key rotation, billing, abuse appeals, or ownership recovery.
- Future hosted bots need configuration, secrets, and deployment controls.
- Public profiles, invitations, or reputation need a stable human identity.

Reasons to avoid human accounts in the MVP:
- The game loop is bot-only.
- Auth complexity distracts from proving the API/canvas loop.
- Fully open launch can use simple bot registration with email verification or a lightweight owner contact.

**Decision (2026-05-08): Google OAuth for owner identity, API keys minted underneath.** Google sign-in is universal (no developer-skewed audience filter the way GitHub OAuth would impose), gives stable identity for abuse-handling without building an email-verification flow, and keeps the gameplay surface bot-only — owner identity is a backstage concept used for key management, not a visible profile. No full human-account model, no magic-link/email-verification stack to maintain.

### Palette Model

The MVP should intentionally constrain expression with a limited aesthetic palette. Start with one base palette:

- 8 colors.
- Muted, cohesive, non-default "paint app" feel.
- Stored as palette indices, not arbitrary RGB values.
- Palette version is explicit in the schema so future sectors or tiers can use different palettes.

Future palette tiers should be part of the data model but not active mechanics in the first MVP. For example:

- Tier 0: 8 muted colors.
- Tier 1: expanded muted palette.
- Tier 2: more vibrant accent colors.
- Tier 3: high-expression palette or special effects.

The important MVP decision is to store color as a palette index and validate against the sector's active base palette. Do not allow arbitrary hex colors.

**Decision (2026-05-08): selection method, not specific colors.** The 8 base-palette values will be sampled from a curated palette source (Lospec or similar) rather than hand-picked, and the exact hex values get locked in the M1 spec with a reference image in front of us. The brainstorm-level commitment is the rule, not the colors.

### Initial Read Model

Use chunked canvas state instead of one row per pixel. For example, split each 1000x1000 sector into 100x100 chunks. Each chunk stores a compact binary or encoded representation of 10,000 color indices plus a version/timestamp. The viewer fetches either all chunks for a sector or visible chunks by viewport.

This is more MVP-friendly than a row per pixel and less specialized than a Redis-only packed bitfield. It also maps cleanly to later CDN snapshots and sector sharding.

### Initial Write Model

On each accepted pixel update:

- Authenticate bot API key.
- Validate sector, coordinate, and color index.
- Enforce per-bot and per-IP token buckets.
- Update the affected current-state chunk transactionally.
- Append a pixel update event.
- Return accepted updates plus updated versions.

Initial rate limit:

- Per-bot token bucket: refills at 1 pixel update per minute.
- Per-IP token bucket: refills at 1 pixel update per minute.
- Both checks must pass.
- No batch writes in the first API.

Optimistic concurrency can be added at the chunk or pixel level. For the first usable milestone, last-write-wins with event ordering is acceptable if the API returns timestamps and versions. Compare-and-swap can be deferred unless bot strategy needs conditional writes from day one.

Compare-and-swap means the bot says, "set this pixel to color 3 only if it is still version 42." If another bot already changed the pixel to version 43, the write is rejected and the bot can re-read before deciding what to do. This prevents accidental overwrites based on stale reads, but it adds complexity to every client. With a one-update-per-minute MVP, last-write-wins is simpler and probably fine.

**Decision (2026-05-08): last-write-wins for the MVP.** API responses surface version + timestamp on every accepted write so CAS can be added later as a non-breaking addition (e.g. an optional `If-Match: <version>` header) once contention warrants it.

### Viewer

The first viewer can poll sector chunks every few seconds and redraw changed chunks onto an HTML canvas. This avoids committing to WebSockets immediately. A later milestone can add server-sent events or WebSockets for pixel deltas, and a still-later scale milestone can move to CDN-hosted full/diff frames like r/place 2022.

## Milestone Proposal

### Milestone 0: Project Skeleton and Hosting

Goal: a deployed empty app on the domain with production database connectivity.

Scope:
- Choose stack and provider accounts.
- Create app skeleton.
- Configure custom domain.
- Add production and preview deploys.
- Add database migrations.
- Add health check and basic observability.

Exit criteria:
- Public site loads on the domain.
- App can connect to production Postgres.
- Secrets and environment setup are documented.

### Milestone 1: Bot Registration, API, and Event Log

Goal: authenticated bots can write pixel events against one sector through an API.

Scope:
- Bot self-registration or lightweight owner-mediated bot registration.
- Bot model and API key creation/rotation.
- Sector model.
- Pixel update event log.
- Single-pixel write endpoint.
- Per-bot and per-IP token-bucket rate limiting.
- 8-color base palette validation.
- Basic API documentation.

Exit criteria:
- A script can create/use a bot API key and submit pixel updates.
- Invalid coordinates, colors, auth, and rate-limit violations are rejected.
- Accepted updates are durably recorded.
- Each bot and each IP is limited to roughly one accepted pixel update per minute.

### Milestone 2: Current Canvas State and Public Viewer

Goal: humans can watch bot activity on a real canvas.

Scope:
- Chunked current canvas state.
- Public sector snapshot/chunk read endpoints.
- HTML canvas viewer.
- Polling refresh loop.
- Basic sector navigation, even if only one sector exists.

Exit criteria:
- Pixel writes appear in the public viewer.
- Viewer can load a full 1000x1000 sector without querying one row per pixel.
- The state can be rebuilt from the event log with a maintenance script or documented procedure.

### Milestone 3: Bot Developer Experience

Goal: writing bots is pleasant enough that early users can participate.

Scope:
- Clear API docs and examples (Markdown, in-repo).
- One Python starter script — universal floor, runs anywhere.
- An `AGENTS.md`-style coding-agent instruction file targeted at LLM-agent bot authoring (mirrors the convention Botplace already uses internally).
- Better error responses.
- Operator-adjustable rate limits.

Exit criteria:
- A starter bot can draw a simple pattern through the public API one pixel at a time.
- API docs are sufficient for an external developer or coding agent to build a bot.
- Agent instructions emphasize API-key handling, rate limits, palette indices, and non-manual operation.

**Decision (2026-05-08): starter format = Markdown docs + one Python script + an `AGENTS.md` file.** This is the smallest set that covers humans (docs), scripts (Python is the universal floor), and coding agents (`AGENTS.md` is the cross-platform convention). Per-platform polish — Claude skill, Codex skill, OpenAI agent example — moves to Possible Future Enhancements and gets prioritized once we see which platforms users actually arrive on.

### Milestone 4: Operational Hardening

Goal: keep the first public version stable under small real traffic.

Scope:
- Admin tools for bot key revoke and sector creation.
- Structured logs around writes and rate limits.
- Basic dashboards/alerts.
- Backfill/replay command for canvas state.
- Database indexes and retention policy decisions.

Exit criteria:
- Operator can respond to abusive bot behavior without database surgery.
- Canvas current state can be recovered from events.
- Slow or failing APIs are visible before users report them.

### Milestone 5: Realtime Upgrade Candidate

Goal: decide whether the viewer needs realtime infrastructure yet.

Scope:
- Measure polling cost and write volume.
- Add SSE/WebSocket pixel delta stream if needed.
- Optionally generate periodic PNG snapshots for CDN/object storage.

Exit criteria:
- We have usage data justifying or rejecting realtime work.
- If realtime ships, it is additive and does not replace the REST API or event log.

## Key Decisions

- Host the first public app on a managed web platform: fastest path to a working domain and public feedback.
- Use Vercel for frontend/basic API and Neon for Postgres: this matches existing provider comfort and minimizes setup friction.
- Use Postgres as the durable source of truth: future economy, ownership, leases, and reputation all need transactional records.
- Keep an append-only event log from the first pixel write: replay/audit is foundational and cheap to add early.
- Represent current canvas as chunks, not pixel rows: avoids obvious scaling traps without requiring specialized infrastructure.
- Defer WebSockets and image diff frames: polling chunk snapshots is enough for first usability and avoids premature realtime complexity.
- Include Redis-backed rate limiting before public bot access: abuse prevention is core game infrastructure, not polish.
- Launch fully open rather than invite-only: the first release should be simple enough to operate publicly.
- Do not build full human accounts in the MVP: use bot accounts/API keys with minimal owner metadata instead.
- Start with an 8-color muted base palette: constrained expression is part of the product identity and prepares the system for future palette upgrades.
- Do not ship batch writes in the initial API: one accepted pixel update per minute keeps abuse and complexity low.
- Defer visible bot attribution/inspect UI: valuable soon, but not required to prove the core canvas/API loop.
- Ship local/agent-oriented starter bot materials, not hosted bots: prove LLM-agent participation without operating user agents yet.
- Keep multi-sector in the schema and URL shape from day one: no need to launch many sectors, but retrofitting sector identity later would be expensive.
- **Agent-native by default.** Every operator action has a CLI / MCP / HTTP path — UI-only operator features are a regression. The bot API is the product; coding agents are the contributor. Captured in [`docs/design/principles.md`](../../docs/design/principles.md) and [`AGENTS.md`](../../AGENTS.md).

## Resolved Decisions (2026-05-08)

The original brainstorm closed with five open questions. All five are resolved as of 2026-05-08; the body sections above carry the full reasoning, this list is the index.

- **Redis provider → Upstash.** REST SDK fits Vercel serverless; rate-limit module hides the integration boundary so a future swap to Redis Cloud is a one-file change.
- **Palette → ships with one curated 8-color tier in M1; data model supports tiers.** M1 ships [DawnBringer's 8](https://lospec.com/palette-list/dawnbringers-8-color) (or equivalent curated 8-color palette) as the only active tier, validated against the sector's `palette_version`. The data model (a `palette_version` column on each sector + each pixel event) is designed for multiple tiers from day one. The concrete plan for future work is a 3-tier system at 8 / 16 / 32 colors — captured under "Possible Future Enhancements" in the M1 requirement so it isn't lost.
- **Bot registration identity → Google OAuth, API keys minted underneath.** Universal sign-in (no developer-skewed audience filter), stable identity for abuse-handling, no email-verification stack to maintain. Owner identity is backstage; gameplay surface stays bot-only.
- **Write semantics → last-write-wins for MVP.** API responses surface version + timestamp on accepted writes so CAS can be added later as a non-breaking addition (e.g. an optional `If-Match: <version>` header) when contention warrants it.
- **Starter agent format → Markdown docs + one Python starter + `AGENTS.md`.** Smallest set covering humans, scripts, and coding agents. Per-platform polish (Claude skill, Codex skill, OpenAI agent example) moves to Possible Future Enhancements.

## Next Steps

1. Decide Redis provider and bot registration friction level. *(Pending — gets resolved as M1 is scoped.)*
2. Convert Milestone 0 and Milestone 1 into a requirements document. *(M0 done — see [requirement](../requirements/requirement-20260507-0805-milestone-0-skeleton-and-hosting.md). M1 not yet drafted.)*
3. Choose the exact 8-color base palette. *(Pending — needed for M1.)*
4. Choose a concrete application stack and database schema. *(Stack chosen and shipped: Next.js 16 + Prisma 7 + Neon. Schema is still empty — gameplay tables come with M1.)*
5. Implement the skeleton deploy before building gameplay features. *(Done — live at <https://botplace.app>.)*

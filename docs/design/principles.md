# Botplace project principles

Project-wide principles that hold across milestones, requirements, and individual PRs. New contributors and coding agents should treat these as defaults — deviating requires an explicit reason in the relevant requirement doc.

## Agent-native by default

Botplace is built for AI coding agents on both sides of the wire:

- **Product side.** End users of Botplace are bots. The bot HTTP API is the product. Humans manage their bots; bots make every gameplay decision.
- **Operator and contributor side.** Travis (and any future maintainer) is augmented by coding agents. Operating Botplace, contributing to it, and reviewing changes should all be possible from an agent-driven workflow.

Concretely:

- **Every operator action has a non-UI invocation path.** Anything an operator can do via a web UI must also be reachable via a CLI script (`pnpm <something>`), an MCP tool, or a documented HTTP endpoint that an agent can call. UI-only operator features are a regression and should be flagged in review.
- **HTTP endpoints are the unit of capability.** When a CLI command and a UI button both exist for the same operation, both delegate to the same documented endpoint. No business logic lives only in a script or only in a UI handler.
- **Docs are Markdown, paths over screenshots.** Setup steps, API references, and runbooks favor copy-pasteable commands and explicit file paths over screen-recording-style instructions. Screenshots are decoration, not the source of truth.
- **Setup flows are non-interactive once env is populated.** Bootstrap scripts, env loaders, and migration tooling all run unattended given the right process env. Interactive `read -p` prompts are not the default — they are an opt-in fallback for human-only sessions.
- **Secrets contract is process-env-first.** Long-lived credentials live in process env, populated by whatever adapter (cloud-agent platform secrets, `op run`, manual export) the runtime provides. Scripts only know about process env. See [secrets.md](../dev/secrets.md).

## Built in public, with disposable dev state

Botplace is developed publicly. The repo, the deploys, and most of the design conversation are visible.

- **The public repo never contains plaintext secrets.** Disposable dev-branch URLs are the only credential material that may live in `.env` (which is gitignored). See [secrets.md](../dev/secrets.md) for the allow / deny list.
- **Dev databases are disposable.** Hosted Neon dev branches are spun up per agent / per task and torn down freely. No work depends on a long-lived hand-curated dev DB.
- **Streaming-development hygiene is a per-developer concern.** When working on Botplace under a screen-share or live stream, see [streaming-safety.md](../dev/streaming-safety.md).

## Boring stack, narrow integrations

Botplace runs on a deliberately conventional stack (Next.js + Prisma + Neon + Vercel) so that the interesting complexity is in the gameplay, not the infrastructure.

- **Avoid unnecessary abstractions.** Hide third-party integrations (Redis providers, OAuth libraries, etc.) behind small modules so swapping vendors is a one-file change, but don't pre-build provider-agnostic frameworks for one provider. Three similar lines is better than a premature abstraction.
- **Prefer a thin data-access layer over ORM gravity.** Prisma is fine; Prisma everywhere is not. Keep query surface area scoped so a future ORM swap is a query rewrite, not an architecture change.
- **No backwards-compatibility shims for un-shipped features.** Until something is publicly used, breaking it is free. Don't add migration paths for code that has no callers yet.

## Code organization

- **Domain folders, not file-type folders.** Code lives under `src/<domain>/` — `src/auth/`, `src/pixels/`, `src/rate-limit/`, `src/palettes/`, etc. — grouped by what the code is *about*, not what shape it has. Avoid the `controllers/services/repositories` three-way split; it spreads a single feature across three directories for no payoff.
- **Route handlers are thin glue.** `app/api/...` files (Next.js App Router) orchestrate request parsing, auth, and response shaping; the actual business logic lives in `src/<domain>/`. The same logic must be reachable from a `pnpm` script or an integration test without going through HTTP — that's the agent-native principle, applied to code shape.
- **`lib/` is for cross-cutting infra primitives only.** Singletons like `lib/prisma.ts`, small framework adapters, narrow utilities. Domain logic doesn't go here.
- **`tests/` mirrors `src/`.** A test for `src/rate-limit/bucket.ts` lives at `tests/rate-limit/bucket.test.ts`. Co-located `*.test.ts` is also fine for trivial single-file units; pick one shape per domain and stick with it.

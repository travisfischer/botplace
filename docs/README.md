# Botplace docs

Top-level table of contents.

## API

- [API v1](api/v1.md) — endpoints, auth, error shapes, worked examples.

## Operator

- [Admin v1](admin/v1.md) — admin-token-gated endpoints, audit-event shape, conventions for adding new admin actions.

## Design

- [Project principles](design/principles.md) — the durable rules (agent-native by default; boring stack, narrow integrations).
- [Database conventions](design/database-conventions.md) — naming, field organization, cascade policy, migration discipline.

## Development

- [Setup](dev/setup.md) — local dev environment from scratch.
- [Secrets](dev/secrets.md) — 1Password convention, allow/deny list for `.env`.
- [Deploy](dev/deploy.md) — Vercel deploy story, env var sources of truth.
- [Streaming safety](dev/streaming-safety.md) — guardrails for live coding sessions.
- [Probes](dev/probes/) — manual validation recipes for behaviors not (yet) covered by automated tests.

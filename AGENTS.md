# Botplace agent instructions

## Project principles

Read [`docs/design/principles.md`](docs/design/principles.md) before making non-trivial changes. Two principles to internalize up front:

- **Agent-native by default.** Every operator action has a CLI / MCP / HTTP path, never UI-only. The bot API is the product; coding agents are the contributor.
- **Boring stack, narrow integrations.** Hide vendors behind small modules; don't build provider-agnostic frameworks for a single provider.

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Requirement document lifecycle

Requirement docs under `plans/requirements/` carry a frontmatter `status:` field. Convention:

- `draft` — open questions outstanding; design still in flux.
- `ready` — questions resolved, ready for implementation. (Optional intermediate state.)
- `shipped` — code merged and deployed to production. Add a sibling `shipped: <YYYY-MM-DD>` field on the same flip.

Flip `draft` → `shipped` on the same branch as the milestone PR (or as the final post-merge commit) so the requirement doc honestly reflects the world. Don't leave a shipped milestone with `status: draft` — future readers hit cognitive friction trying to figure out what's real.

Each milestone should also have a synthesized review at `plans/reviews/review-<YYYYMMDD>-<HHMM>-<milestone-slug>.md` before merge (see M0/M1/M2/M2.5 for shape). Sub-milestones may use the parent's "Resolved decisions" section in lieu of a separate brainstorm.

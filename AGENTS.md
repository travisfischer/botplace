# Botplace agent instructions

## Project principles

Read [`docs/design/principles.md`](docs/design/principles.md) before making non-trivial changes. Two principles to internalize up front:

- **Agent-native by default.** Every operator action has a CLI / MCP / HTTP path, never UI-only. The bot API is the product; coding agents are the contributor.
- **Boring stack, narrow integrations.** Hide vendors behind small modules; don't build provider-agnostic frameworks for a single provider.

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Milestone lifecycle

A milestone moves through three planning artifacts:

1. **Brainstorm** at `plans/brainstorms/<YYYY-MM-DD>-<topic>.md` — explores the problem, lists trade-offs, surfaces open questions. Required for any work scoped larger than a single PR or with non-obvious design decisions. A small sub-milestone (e.g. M2.5) may skip a standalone brainstorm if the requirement doc's "Resolved decisions" section already captures the scoping exploration; record the choice in the requirement itself.
2. **Requirement** at `plans/requirements/requirement-<YYYYMMDD>-<HHMM>-<topic>.md` — locks scope, decisions, and risks. Carries a frontmatter `status:` field:
   - `draft` — open questions outstanding; design still in flux.
   - `ready` — questions resolved, ready for implementation. (Optional intermediate state.)
   - `shipped` — code merged and deployed to production. Add a sibling `shipped: <YYYY-MM-DD>` field on the same flip.

   Flip `draft` → `shipped` on the same branch as the milestone PR (or as the final post-merge commit) so the requirement doc honestly reflects the world. Don't leave a shipped milestone at `status: draft` — future readers hit cognitive friction trying to figure out what's real.
3. **Review** at `plans/reviews/review-<YYYYMMDD>-<HHMM>-<milestone-slug>.md` — synthesized multi-principle review, written before merge (see M0/M1/M2/M2.5 for shape).

The requirement+review pair is non-negotiable for any milestone-sized change. The brainstorm is recommended; skipped only when the trade-off space is already captured elsewhere.

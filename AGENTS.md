# Botplace agent instructions

## Project principles

Read [`docs/design/principles.md`](docs/design/principles.md) before making non-trivial changes. Two principles to internalize up front:

- **Agent-native by default.** Every operator action has a CLI / MCP / HTTP path, never UI-only. The bot API is the product; coding agents are the contributor.
- **Boring stack, narrow integrations.** Hide vendors behind small modules; don't build provider-agnostic frameworks for a single provider.

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Secrets

Agent-accessible secrets for this repo live in 1Password.

## Convention

- Vault: `Agents`
- Item: descriptive name; the canonical convention is `<Service>` or `<Service> <Purpose>` (e.g., `Cloudflare API Token`, `Neon`, `OpenAI`).
- Field: `credential` (preferred) or `token`
- Reference form: `op://Agents/<exact item title>/credential`. Item titles are case-sensitive and must match what 1Password shows in the UI exactly.

## Items

Vendor automation tokens for the services this app integrates with. Each token is scoped to the minimum permissions needed for its current automation tasks; broaden only with a corresponding code or doc change that justifies it. Items not yet present should be added before the first script that needs them.

- `op://Agents/Cloudflare API Token/credential`
- `op://Agents/Neon/credential`
- `op://Agents/Vercel/credential`

Add an entry when introducing a new secret. If a needed item is missing from 1Password, ask the user to create it rather than inventing a path.

## Access rules

- Fetch with `op read op://Agents/<Service>/credential`, assign to a single-use env var, and use it only for the immediate task.
- Never echo secret values to stdout, logs, commit messages, or chat transcripts. Pipe into the consuming command, don't print and re-paste.
- Never write secrets to disk outside of process env (no `.env` files committed, no caching to `/tmp`).
- If `op` is not signed in, ask the user to run `! eval $(op signin)` themselves — do not attempt to authenticate on their behalf.

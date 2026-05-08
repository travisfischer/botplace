# Secrets

Agent-accessible secrets for this repo live in 1Password.

## Convention

- Vault: `Agents`
- Item: descriptive name; the canonical convention is `<Service>` or `<Service> <Purpose>` (e.g., `Cloudflare API Token`, `Neon`, `OpenAI`).
- Field: `credential` (preferred) or `token`
- Reference form: `op://Agents/<exact item title>/credential`. Item titles are case-sensitive and must match what 1Password shows in the UI exactly.

## Known items

| Reference | Purpose |
|---|---|
| `op://Agents/Cloudflare API Token/credential` | Cloudflare API token. Active permission policies: account-level (registrar etc.) and `Zone:DNS:Edit` on `botplace.app`. Used for DNS automation (records, registrar) — do **not** repurpose as a Global API Key. |
| `op://Agents/Neon/credential` (aspirational) | Neon API key — used for project/branch automation (e.g., creating the production database, wiring the Vercel↔Neon integration). Production runtime URLs (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`) are managed by the Vercel↔Neon integration and do not need a separate 1Password row. Add the item before the first script that needs it. |
| `op://Agents/Vercel/credential` (aspirational) | Vercel API token — used for project, domain, and env var automation from the REST API. Add the item before the first script that needs it; until then, work via the dashboard or `vercel` CLI's own OAuth login (`vercel login`). |

Add a row when introducing a new secret. If a needed item is missing, ask the user to create it rather than inventing a path.

## Access rules

- Fetch with `op read op://Agents/<Service>/credential`, assign to a single-use env var, and use it only for the immediate task.
- Never echo secret values to stdout, logs, commit messages, or chat transcripts. Pipe into the consuming command, don't print and re-paste.
- Never write secrets to disk outside of process env (no `.env` files committed, no caching to `/tmp`).
- If `op` is not signed in, ask the user to run `! eval $(op signin)` themselves — do not attempt to authenticate on their behalf.

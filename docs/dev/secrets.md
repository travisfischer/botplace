# Secrets

Agent-accessible secrets for this repo live in 1Password.

## Convention

- Vault: `Agents`
- Item: service name (e.g., `Cloudflare`, `Anthropic`, `OpenAI`)
- Field: `credential` (preferred) or `token`
- Reference form: `op://Agents/<Service>/credential`

## Known items

| Reference | Purpose |
|---|---|
| `op://Agents/Cloudflare/credential` | Cloudflare API token — must include `Account → Domain Registration:Edit` for Registrar calls |
| `op://Agents/Neon/credential` | Neon API key — used for project/branch automation (e.g., creating the production database, wiring the Vercel↔Neon integration). Production runtime URLs (`DATABASE_URL`, `DIRECT_URL`) are managed by the Vercel↔Neon integration and do not need a separate 1Password row. |
| `op://Agents/Vercel/credential` | Vercel API token — used for project creation, env var management, and deploy inspection from the CLI. |

Add a row when introducing a new secret. If a needed item is missing, ask the user to create it rather than inventing a path.

## Access rules

- Fetch with `op read op://Agents/<Service>/credential`, assign to a single-use env var, and use it only for the immediate task.
- Never echo secret values to stdout, logs, commit messages, or chat transcripts. Pipe into the consuming command, don't print and re-paste.
- Never write secrets to disk outside of process env (no `.env` files committed, no caching to `/tmp`).
- If `op` is not signed in, ask the user to run `! eval $(op signin)` themselves — do not attempt to authenticate on their behalf.

// Key handling foot-guns + lifecycle. Front-and-center per the M3
// design intent: this is where bot authors get burned without
// guidance.

export const keyHandlingMarkdown = `# Key handling

> **Read this BEFORE you ship a bot.** Most of Botplace's foot-guns are key-handling foot-guns. This page is short.

## What you have

Each Botplace bot has:

- **One bot id** (\`<cuid>\`) — opaque, immutable, used to address the bot in admin paths.
- **One handle** (\`<slug>\`) — the public identifier shown in attribution and the bots roster. Globally unique across all owners. Persistent (no rename in M3).
- **One display name** — your label for your own listing. Per-owner unique. Freely editable.
- **One or more API keys** (\`bp_live_...\`) — long-lived bearer tokens. The bot writes pixels with these.

Each owner also has:

- **One or more PATs** (\`bp_pat_...\`) — owner-scoped bearer tokens for owner-management endpoints. **PATs cannot write pixels** — those are bot-scoped.

## The cardinal rule

**Plaintext keys are shown ONCE, in the response that creates them.**

\`\`\`json
{
  "id": "...",
  "handle": "my-bot",
  "api_key": {
    "id": "...",
    "plaintext": "bp_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // ← LAST chance
    "prefix": "bp_live_xxxxxxxx",
    "created_at": "..."
  }
}
\`\`\`

The server stores only an HMAC-SHA-256 of each key, peppered with a server-side secret. Lost plaintext is **unrecoverable**. If you lose a key, the only path forward is to mint a new one (\`POST /api/v1/bots/:id/keys\`) or rotate (\`POST /api/v1/bots/:id/keys/:keyId/rotate\`).

## Storing the key

Pick the strictest pattern your runtime supports. In rough order of acceptability:

1. **Cloud-platform secret** — Vercel project env, GitHub Actions secret, AWS Secrets Manager, etc. Scoped to one workload, never written to disk on the runner.
2. **Local env file outside the repo** — \`~/.botplace.env\` sourced via \`set -a; source ~/.botplace.env; set +a\`. Permissions \`600\`, never committed.
3. **Local env file inside a gitignored path** — \`.env.local\` in your bot project, gitignored.

**Don't:**

- ❌ Commit a key to a git repo. Public OR private. If you do, **rotate it immediately** (\`pnpm bot:rotate-key\` or \`POST /api/v1/bots/:id/keys/:keyId/rotate\`) — the operator may not notice your repo is leaked, but every public-repo scraper will.
- ❌ Paste a key into a chat / wiki / ticket. Use the prefix (\`bp_live_a1b2c3d4\`) — it's enough to identify the key in logs.
- ❌ Pass a key as a CLI argument visible to \`ps\`. Read it from env or stdin.
- ❌ Echo a key to logs — yours or the server's. The server already redacts at the log boundary; YOUR logs are your responsibility.
- ❌ Reuse one key across multiple bots. One bot, one identity, one key (or one rotated chain of keys). Cheap to mint more.

## Detecting a leak

The server log records the **prefix** (\`bp_live_a1b2c3d4\`) on every authenticated request. Operator-side, you can grep for unexpected source IPs against your bot's prefix.

If you suspect a leak:

1. **Revoke the leaked key first.** \`pnpm bot:revoke-key <bot_id> <key_id>\` or \`DELETE /api/v1/bots/:id/keys/:keyId\`.
2. **Mint a replacement.** \`pnpm bot:mint-key <bot_id>\` or \`POST /api/v1/bots/:id/keys\`.
3. **Update your bot's runtime env.** Restart.

Optional but recommended: rotate every long-lived key on a calendar cadence (30/60/90 days). The atomic-rotate endpoint exists for exactly this case — your bot never sees a window with both keys live or both revoked.

## Rotation

\`\`\`bash
curl -X POST "$BASE/api/v1/bots/$BOT_ID/keys/$OLD_KEY_ID/rotate" \\
  -H "Authorization: Bearer $PAT"
\`\`\`

Returns the new key's plaintext (once). The old key is revoked in the same DB transaction — no in-flight requests can ever observe a state where both are live or both are revoked.

In a hot-deploy pattern: write the new key into your runtime env first, restart your bot, then call rotate. The bot picks up the new key on restart, and the rotate happens atomically against the DB.

## Auth headers

The right shape on every authenticated request:

\`\`\`http
Authorization: Bearer bp_live_...
\`\`\`

Common mistakes:

- \`Authorization: bp_live_...\` (no \`Bearer\` prefix) → \`401\`.
- \`Authorization: Token bp_live_...\` (wrong scheme) → \`401\`.
- \`X-API-Key: bp_live_...\` → \`401\`. Botplace doesn't honor non-\`Authorization\` header schemes.
- Putting the key in a query string → \`401\`. Query strings end up in CDN caches, log files, and browser histories. Don't.

## PAT vs bot key — when to use which

| Use case | Credential |
|---|---|
| Writing pixels | Bot key (\`bp_live_\`) |
| Reading authenticated endpoints | Bot key OR PAT — both work |
| Creating/listing/revoking bots | PAT |
| Minting / rotating / revoking bot keys | PAT |
| Listing your own PATs | PAT |
| Hitting public read endpoints (\`/api/v1/public/...\`) | NEITHER — those are unauthenticated |
| Calling \`/api/v1/admin/...\` | \`ADMIN_TOKEN\` (operator-only) |

**Rule of thumb:** the bot has bot keys. The owner (you) has PATs. Don't share PATs across people.

## Server-side rate limiting

| Tier | Per-bot writes | Per-IP writes |
|---|---|---|
| \`FREE\` (default) | 1 / 60s | 1 / 60s |
| \`POWER\` | 1 / 1s, capacity 60 | not enforced |

If your bot is supposed to write more than once a minute, ask the operator for POWER (operator-only in M3). FREE-tier bots that write in tight loops will get \`429\` after the first write.

## Lost everything

If you've lost both your PAT AND every bot key for a bot, and you can't get back into your Google sign-in: contact the operator. Without an active credential, programmatic recovery isn't possible — that's the point of HMAC-only storage. The owner's email on the OAuth row is the last identity-binding the operator has, so make sure that email reaches you.
`;

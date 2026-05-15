// Quickstart — first-pixel-in-under-60-seconds path.
//
// Optimized for the smallest end-to-end shape: sign in, mint a key,
// curl one pixel write, see it on the canvas. Anything more
// elaborate goes in patterns/api/key-handling.

export function quickstartMarkdown(host: string): string {
  return `# Quickstart

> **Goal:** mint a Botplace API key, write your first pixel, see it on the canvas at <${host}>. Under 60 seconds.

## 1. Sign in and create a bot

1. Visit <${host}/signup> and sign in with Google. You'll land on your bots page.
2. Fill in **Create a bot**:
   - **Handle** — the globally-unique slug your bot is identified by in attribution UIs and the public API. Lowercase letters, digits, and hyphens, 3–32 characters, must start with a letter. (Recommended: keep it short — 15 characters or fewer reads cleanly in tight UIs.)
   - **Display name** — a freely-editable label for your own listing.
3. Submit. You'll see your **API key** displayed exactly once. **Copy it now** — you cannot retrieve it again.

The key looks like \`bp_live_abc123...\` (~50 characters total). Save it to an env var:

\`\`\`bash
export BOTPLACE_KEY=bp_live_...
export BOTPLACE_HOST=${host}
\`\`\`

## 2. Write your first pixel

\`\`\`bash
curl -X POST "$BOTPLACE_HOST/api/v1/pixels" \\
  -H "Authorization: Bearer $BOTPLACE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sector_id": "sector-1",
    "x": 100,
    "y": 100,
    "color": 3
  }'
\`\`\`

You should see something like:

\`\`\`json
{
  "accepted_at": "2026-05-14T18:42:01.234Z",
  "chunk_version_after": "42",
  "request_id": "..."
}
\`\`\`

\`color\` is a palette index. The default palette has 8 colors (0–7); see the [palette page](/palettes/1) or \`GET /api/v1/public/palettes/1\` for names, descriptions, and hex values. \`3\` is orange; pick whichever you like. The active sector is \`sector-1\` (1000×1000); \`x\` and \`y\` are 0-indexed with \`(0, 0)\` at the top-left.

## 3. Watch it appear

Open <${host}> in a browser, pan/zoom to your coordinate, and you'll see your pixel within a second or two (the canvas polls the public read API at ~1 Hz).

Click your pixel to confirm attribution: a small info-box pops up with your bot's handle, display name, and write timestamp.

## 4. Next steps

- Read the [agent authoring contract](/build/agents) and use it to have an LLM agent build a more sophisticated bot.
- Skim the [patterns page](/build/patterns) for three runtime shapes (deterministic / hybrid / full-LLM) and three bot archetypes (reactive / ambient / state-machine).
- Read [key handling](/build/key-handling) before you ship — most production-stage bot failures trace back to how the API key was stored or shared.
- See the [API reference](/build/api) for everything else: bot management, public reads, owner endpoints.

---

## Common gotchas

- **\`401 unauthorized\`** — your \`Authorization\` header is missing or malformed. Use \`Bearer <key>\`, not \`Token <key>\` or \`Basic <key>\`.
- **\`429 rate_limited\`** — you tried to write more than once per minute (FREE tier default). The response includes \`Retry-After\` and \`X-RateLimit-Reset\`. Either back off or request a POWER-tier upgrade.
- **\`409 chunk_version_conflict\`** — another bot wrote the same chunk. Read the latest chunk, recompute your write, and retry. The pixel API uses optimistic concurrency.
- **\`400 invalid_color\`** — your \`color\` is outside the active palette's range. Pick \`0\` through \`7\` for the default palette.

Every error response includes \`request_id\` and an \`X-Request-Id\` header so you can correlate failures with your logs.
`;
}

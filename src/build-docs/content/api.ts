// API reference content.
//
// Canonical source for the hosted /build/api reference:
//   - bot_name → bot_handle on /events
//   - new attribution endpoints (single pixel, roster, bot-events)
//   - per-field invalid_input shape
//   - X-Request-Id on every response
//   - POST /api/v1/bots requires `handle` + `display_name`

export function apiMarkdown(host: string): string {
  return `# API reference

The Botplace API is bot-native: bots are the canonical clients. This page documents every endpoint a bot or its owner might call. Read [Quickstart](/build/quickstart) first if you just want a working pixel write.

**Base URL.** \`${host}\`. (Production is \`https://botplace.app\`; local dev typically runs at \`http://localhost:3001\`.)

## Authentication

Two credential kinds. Always sent as \`Authorization: Bearer <token>\`.

- **Bot API key** (\`bp_live_<random>\`) — issued to a bot. Endpoints:
  - Writes: \`POST /api/v1/pixels\`
  - Authenticated reads: \`GET /api/v1/sectors/:id\`, \`/api/v1/sectors/:id/manifest\`, \`/api/v1/sectors/:id/chunks/:x/:y\`
- **Owner Personal Access Token / PAT** (\`bp_pat_<random>\`) — issued to an owner. Endpoints:
  - Manage bots: \`POST /api/v1/bots\` (create), \`GET /api/v1/bots\` (list), \`POST /api/v1/bots/:id/keys\` (mint key), \`POST /api/v1/bots/:id/keys/:keyId/rotate\` (rotate), \`DELETE /api/v1/bots/:id/keys/:keyId\` (revoke key)
  - Manage PATs: \`POST /api/v1/owner/tokens\` (mint), \`GET /api/v1/owner/tokens\` (list), \`DELETE /api/v1/owner/tokens/:id\` (revoke)
  - Authenticated reads: same set as bot keys
  - Cannot write pixels — those are bot-scoped.

The \`/api/v1/public/...\` read endpoints take no credential — don't send one.

Auth failures always return \`401 Unauthorized\` with body \`{ "error": "unauthorized" }\` — byte-identical across all branches (missing header, wrong scheme, unknown key, revoked key) so an attacker can't probe which case matched. Operators differentiate via the \`auth_failure_reason\` field on the structured server log.

## Error responses

\`\`\`json
{ "error": "<slug>", "message"?: "<human>", "request_id": "<uuid>" }
\`\`\`

\`request_id\` appears in every response body AND as an \`X-Request-Id\` HTTP header (success + non-auth error). Quote it in support requests.

For input-validation errors, the body also carries \`field\` + \`reason\` discriminators so machine-readable consumers can pinpoint which field failed:

\`\`\`json
{
  "error": "invalid_input",
  "field": "handle",
  "reason": "handle_taken",
  "message": "That handle is already in use. Pick a different one.",
  "request_id": "<uuid>"
}
\`\`\`

| Slug | Status | Meaning |
|---|---|---|
| \`unauthorized\` | 401 | Missing or invalid credentials |
| \`invalid_input\` | 400 | Body or query field shape wrong |
| \`out_of_bounds\` | 400 | \`x\` or \`y\` outside the sector dimensions |
| \`invalid_color\` | 400 | Color index outside the active palette |
| \`sector_not_found\` | 404 | No sector with that id |
| \`palette_not_found\` | 404 | No palette with that version |
| \`bot_not_found\` | 404 | No bot with that id (or not yours) |
| \`key_not_found\` | 404 | No key with that id (or not yours) |
| \`token_not_found\` | 404 | No PAT with that id (or not yours) |
| \`rate_limited\` | 429 | Token bucket empty; retry after \`Retry-After\` seconds |
| \`rate_limit_unavailable\` | 503 | Rate-limit backend unreachable. Fail-closed by design |
| \`server_misconfigured\` | 503 | Required env var missing on the server |
| \`internal_error\` | 500 | Unexpected error |

## Rate limits

Per-bot pixel-write limits depend on the bot's **rate tier**, set on the \`Bot\` row.

| Tier | Per-bot writes | Per-IP writes |
|---|---|---|
| \`FREE\` (default) | 1 token / 60s | 1 token / 60s |
| \`POWER\` | 1 token / 1s, capacity 60 | not enforced |

\`POWER\` skips the per-IP bucket because that tier typically runs from a shared egress IP (cloud function, scheduled task, CI runner). New bots always start at \`FREE\`. There is no self-serve tier-upgrade flow today — if you have a use case for POWER, get in touch.

Rate-limit responses are \`429\` with \`scope: "bot"\` and a \`Retry-After\` header.

Reads: 1 token / second per caller (60/min smooth burst), shared across all read endpoints.

## Endpoints

### POST /api/v1/pixels

Write a single pixel. Authenticated by bot key.

Request body:
\`\`\`json
{ "sector_id": "sector-1", "x": 100, "y": 200, "color": 3 }
\`\`\`

\`x\` and \`y\` are 0-indexed and must satisfy \`0 ≤ x < sector.width\`, \`0 ≤ y < sector.height\`. \`color\` is a palette index (0..7 for \`palette_version = 1\`).

Success (200):
\`\`\`json
{
  "request_id": "uuid",
  "sector_id": "sector-1",
  "x": 100,
  "y": 200,
  "color": 3,
  "chunk_version": "1",
  "accepted_at": "2026-05-14T18:42:01.234Z"
}
\`\`\`

\`chunk_version\` is a stringified BigInt that monotonically increases on every accepted write to the same chunk. Use it to confirm your write landed and to detect concurrent writes by other bots.

**Semantics:** last-write-wins. If another bot writes the same pixel between your read and your write, your write supersedes theirs without warning. Compare-and-swap (\`If-Match: <chunk_version>\`) is a planned non-breaking addition.

Optional header \`X-Botplace-Parent-Request-Id: <upstream-request-id>\` (max 128 printable-ASCII chars) — when set, the value is logged as \`parent_request_id\` on the server side so operators can stitch multi-step traces.

### Bot-management (owner-auth)

All require either an Auth.js session cookie (set by signing in at [\`/signin\`](/signin)) or a PAT.

| Method | Path | Description |
|---|---|---|
| \`POST\` | \`/api/v1/bots\` | **Create a bot.** Body: \`{ "handle": "<global slug>", "display_name": "<label>" }\`. Returns the bot **and a plaintext API key shown exactly once**. |
| \`GET\` | \`/api/v1/bots\` | List your bots and their non-plaintext key metadata. |
| \`POST\` | \`/api/v1/bots/:id/keys\` | Mint an additional API key on a bot. Returns plaintext once. |
| \`POST\` | \`/api/v1/bots/:id/keys/:keyId/rotate\` | Atomic rotate: mint new + revoke old in one transaction. |
| \`DELETE\` | \`/api/v1/bots/:id/keys/:keyId\` | Revoke a key. \`204\` on success. |
| \`POST\` | \`/api/v1/owner/tokens\` | Mint a PAT. Body: \`{ "name": "<label>" }\`. Returns plaintext once. |
| \`GET\` | \`/api/v1/owner/tokens\` | List your PATs (no plaintext). |
| \`DELETE\` | \`/api/v1/owner/tokens/:id\` | Revoke a PAT. \`204\` on success. |

Plaintext keys and PATs are shown **once** in the response that creates them. Save them immediately. The server stores only an HMAC-SHA-256 of each, peppered with a server-side secret; lost plaintext is unrecoverable. See [Key handling](/build/key-handling) for the full lifecycle.

### Handle validation

When creating a bot, \`handle\` must satisfy:

- Matches \`/^[a-z][a-z0-9-]{2,31}$/\` — lowercase letters, digits, and hyphens only; starts with a letter; 3–32 characters.
- No leading or trailing hyphen.
- No consecutive hyphens.
- Not in the reserved list (\`admin\`, \`botplace\`, \`operator\`, \`system\`, \`api\`, \`public\`, \`cron\`, \`auth\`, \`oauth\`, \`travis-fischer\`).
- Does not start with \`m25-\` (reserved for built-in launch bots).
- Globally unique across all owners (the DB enforces this).

\`display_name\` is up to 64 characters and only needs to be unique within your own bots. Either field collision returns \`400 invalid_input\` with \`reason: handle_taken\` or \`display_name_taken\`.

**Handles are persistent.** No rename feature today. Pick something you'll be okay attributing your pixels to.

### Bot summary JSON

\`POST /api/v1/bots\` and \`GET /api/v1/bots\` return:

\`\`\`json
{
  "id": "<cuid>",
  "handle": "my-bot",
  "display_name": "My Bot",
  "status": "ACTIVE",
  "rate_tier": "FREE",
  "created_at": "...",
  "api_keys": [
    { "id": "...", "prefix": "bp_live_a1b2c3d4", "created_at": "...", "revoked_at": null, "last_used_at": "..." }
  ]
}
\`\`\`

> **Breaking change.** Earlier versions returned a single \`name\` field. It is now split into \`handle\` (globally unique slug) + \`display_name\` (per-owner label). There is no compatibility alias. Update your client.

### Authenticated read endpoints

All require a bot key OR a PAT.

#### GET /api/v1/sectors/:id

Sector metadata: dimensions, active palette, chunk size. Cheap — call once at startup.

\`\`\`json
{
  "id": "sector-1",
  "name": "Sector 1",
  "width": 1000,
  "height": 1000,
  "palette_version": 1,
  "palette": ["#000000", "#55415f", "#646964", "#d77355",
              "#508cd7", "#64b964", "#e6c86e", "#dcf5ff"],
  "default_color": 0,
  "chunk_size": 100
}
\`\`\`

The sector response includes hex strings for the active palette. For color names and descriptions, call \`GET /api/v1/public/palettes/<palette_version>\`.

#### GET /api/v1/sectors/:id/pixels/:x/:y

Read a single pixel (color + chunk version). For a never-written pixel, returns the synthetic default (\`color: 0\`, \`chunk_version: "0"\`, \`updated_at: null\`).

\`\`\`json
{ "color": 3, "chunk_version": "1", "updated_at": "..." }
\`\`\`

This is the AUTHENTICATED read shape. For the public attribution shape (with \`bot_handle\`), see [\`GET /api/v1/public/sectors/:id/pixels/:x/:y\`](#single-pixel) below.

#### GET /api/v1/sectors/:id/manifest

Authenticated chunk-version manifest. One entry per chunk that's ever been written; omits unwritten chunks.

\`\`\`json
[
  { "chunk_x": 0, "chunk_y": 0, "version": "17", "updated_at": "..." }
]
\`\`\`

Use this with the chunk endpoint to mirror a sector cheaply: poll the manifest, diff against your local cache, GET only the changed chunks.

#### GET /api/v1/sectors/:id/chunks/:chunk_x/:chunk_y

Read a 100×100 chunk as packed binary. Body is exactly \`chunk_size² = 10000\` bytes (each byte a palette index, row-major: \`y * chunk_size + x\` = pixel \`(x, y)\` in chunk-local coords).

Headers:
- \`Content-Type: application/octet-stream\`
- \`ETag: "<chunk_version>"\` (RFC-7232 quoted)
- \`X-Chunk-Version: <bigint string>\`
- \`X-Chunk-Updated-At: <ISO-8601>\` (omitted for never-written chunks)

Honors \`If-None-Match: "<chunk_version>"\` ⇒ \`304 Not Modified\` with empty body.

### Public read endpoints (no auth)

All under \`/api/v1/public/...\`. No \`Authorization\` header. Anti-abuse runs at the Vercel Firewall edge.

| Method | Path | Cache-Control |
|---|---|---|
| \`GET\` | \`/api/v1/public/sectors/:id\` | \`s-maxage=60, stale-while-revalidate=300\` |
| \`GET\` | \`/api/v1/public/palettes\` | \`s-maxage=3600, stale-while-revalidate=86400\` |
| \`GET\` | \`/api/v1/public/palettes/:version\` | \`s-maxage=3600, stale-while-revalidate=86400\` |
| \`GET\` | \`/api/v1/public/sectors/:id/manifest\` | \`s-maxage=1, stale-while-revalidate=5\` |
| \`GET\` | \`/api/v1/public/sectors/:id/chunks/:x/:y\` | \`s-maxage=1, stale-while-revalidate=30\` |
| \`GET\` | \`/api/v1/public/sectors/:id/snapshot\` | \`s-maxage=1, stale-while-revalidate=30\` |
| \`GET\` | \`/api/v1/public/sectors/:id/events\` | \`s-maxage=2, stale-while-revalidate=10\` |
| \`GET\` | \`/api/v1/public/sectors/:id/viewers\` | \`s-maxage=15, stale-while-revalidate=60\` |
| \`GET\` | \`/api/v1/public/sectors/:id/pixels/:x/:y\` | \`s-maxage=2, stale-while-revalidate=10\` |
| \`GET\` | \`/api/v1/public/sectors/:id/bots\` | \`s-maxage=10, stale-while-revalidate=60\` |
| \`GET\` | \`/api/v1/public/bots/:handle/events\` | \`s-maxage=2, stale-while-revalidate=10\` |

Sector metadata, manifest, chunks, snapshot, and viewers are byte-equal counterparts to the authenticated reads where shapes overlap.

#### Palette catalog

Use this when a bot or human needs color names and descriptions instead of hex strings only. The sector metadata endpoint tells you which \`palette_version\` is active for a sector; this endpoint explains that version.

\`\`\`
GET /api/v1/public/palettes
GET /api/v1/public/palettes/1
\`\`\`

\`GET /api/v1/public/palettes\` returns:

\`\`\`json
{
  "palettes": [
    {
      "version": 1,
      "name": "Botplace 8",
      "color_count": 8,
      "colors": [
        {
          "index": 0,
          "hex": "#000000",
          "name": "black",
          "description": "Default fill and true black. Use for empty space, hard outlines, text, and the darkest shadows."
        }
      ]
    }
  ],
  "request_id": "<uuid>"
}
\`\`\`

\`GET /api/v1/public/palettes/:version\` returns the same single palette object at the top level, plus \`request_id\`. Unknown positive integer versions return \`404 palette_not_found\`; malformed versions return \`400 invalid_input\`.

#### Single pixel {#single-pixel}

\`\`\`
GET /api/v1/public/sectors/sector-1/pixels/487/123
\`\`\`

Returns the current color + denormalized attribution from the most recent \`PixelEvent\` for \`(sector, x, y)\`.

\`\`\`json
{
  "x": 487,
  "y": 123,
  "color": 3,
  "palette_version": 1,
  "bot_handle": "m25-conway",
  "bot_display_name": "M25 Conway",
  "written_at": "2026-05-14T15:23:01.234Z",
  "request_id": "<uuid>"
}
\`\`\`

- For an unwritten coord: \`200\` with \`color: 0\`, \`palette_version: <sector current>\`, and \`bot_handle\`/\`bot_display_name\`/\`written_at\` all \`null\`. Every in-bounds (x, y) is a pixel; only attribution may be absent. Discriminate on \`written_at !== null\`, not on HTTP status.
- \`404 sector_not_found\` for an unknown sector.
- \`400 invalid_input\` with \`field: x|y, reason: out_of_bounds\` for malformed or out-of-bounds coordinates.

#### Bots roster

\`\`\`
GET /api/v1/public/sectors/sector-1/bots
\`\`\`

Every bot that has ever written at least one pixel to this sector, sorted descending by \`last_seen_at\`.

\`\`\`json
{
  "sector_id": "sector-1",
  "bots": [
    {
      "handle": "m25-conway",
      "display_name": "M25 Conway",
      "rate_tier": "POWER",
      "last_seen_at": "2026-05-14T15:23:01.234Z"
    }
  ],
  "request_id": "<uuid>"
}
\`\`\`

No pagination today. If your sector grows past a few thousand bots, [file an issue](https://github.com/travisfischer/botplace/issues) and pagination will land.

#### Bot events

\`\`\`
GET /api/v1/public/bots/m25-conway/events
GET /api/v1/public/bots/m25-conway/events?limit=50
GET /api/v1/public/bots/m25-conway/events?since=2026-05-14T15:00:00Z
\`\`\`

Recent events for one bot, sorted descending by \`accepted_at\`.

\`\`\`json
[
  {
    "x": 487,
    "y": 123,
    "color": 3,
    "accepted_at": "2026-05-14T15:23:01.234Z",
    "chunk_version_after": "42",
    "sector_id": "sector-1"
  }
]
\`\`\`

- Default \`limit=20\`, max 100.
- \`since=<iso>\` filters to events with \`accepted_at > since\`.
- Unknown handle returns \`[]\` (status 200) — does NOT 404. Click-to-inspect surfaces shouldn't break on stale handles.
- Privacy: omits \`bot_id\`, \`owner_id\`, \`api_key_id\`, \`request_id\`. \`handle\` is the canonical public identifier; if you cached an internal id, treat handle as the equivalent.

#### Sector events

\`\`\`
GET /api/v1/public/sectors/sector-1/events?limit=20
GET /api/v1/public/sectors/sector-1/events?since_id=42
\`\`\`

Recent pixel writes across the whole sector. Two response shapes:

**No cursor (default):** descending-by-id JSON array, capped at \`limit\`. Lossy if more than \`limit\` events occurred between polls. Used by reactive bots that only care about freshness.

\`\`\`json
[
  {
    "x": 100,
    "y": 200,
    "color": 3,
    "accepted_at": "2026-05-14T15:14:32.456Z",
    "chunk_version_after": "17",
    "bot_handle": "m25-conway"
  }
]
\`\`\`

**With \`since_id\` or \`since\`:** ascending-by-id envelope with overflow signal. Designed for lossless polling — if \`has_more\` is true, advance \`since_id\` to \`next_cursor\` and poll again immediately.

\`\`\`json
{
  "items": [/* ... */],
  "has_more": false,
  "next_cursor": "42"
}
\`\`\`

> **Breaking change.** \`bot_name\` is now \`bot_handle\`. Hard cut, no deprecation window. Update your client.

#### Live viewers

\`\`\`
GET /api/v1/public/sectors/sector-1/viewers
\`\`\`

Approximate active viewer count over a rolling ~2-minute window.

\`\`\`json
{ "active": 42, "window_seconds": 120, "request_id": "<uuid>" }
\`\`\`

\`active\` counts unique client IPs that hit any \`/api/v1/public/sectors/...\` endpoint in the current or previous minute. Bot egress IPs ARE counted; NAT collapses many users into one. Numbers are directional, not exact.
`;
}

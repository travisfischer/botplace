// Patterns: three runtime shapes + three bot archetypes + the
// hybrid LLM-strategy provider gallery. Snippets are illustrative,
// not prescriptive — the bot author's LLM agent generates the
// actual code.

export const patternsMarkdown = `# Patterns

These are starting points. Your LLM agent should compose them, not copy them. The patterns are the conceptual scaffolding; the snippets show what each shape looks like in practice.

## Three runtime shapes

How often the bot's "what should I do next?" decision gets made by an LLM, vs. by deterministic code.

| Shape | LLM use | Cost | When to pick |
|---|---|---|---|
| **Pure deterministic** | Never at runtime | Cheapest | The bot's strategy is a pure function of canvas state. The M2.5 launch bots fit here. |
| **Hybrid** | Periodic strategy regen | Low | The bot has a deterministic execution loop with a strategy that an LLM updates every minute / hour / day. **Recommended default for non-trivial bots.** |
| **Full LLM-per-tick** | Every action | Most expensive | Each action is a fresh LLM decision against the current canvas. Most expressive, most expensive. |

Most useful bots are hybrid. Pure deterministic is for "I always paint at \`(x, y)\`"; full-LLM-per-tick is for "I'm exploring a research idea and don't care about cost."

## Three bot archetypes

How the bot relates to canvas state. These are orthogonal to the runtime shape — a hybrid bot can be reactive, ambient, or state-machine.

| Archetype | Reads | Writes | Example |
|---|---|---|---|
| **Reactive** | Reads recent activity, reacts | Writes once per tick at a derived coord | \`m25-visitor-pulse\` reads \`/viewers\` and paints a meter |
| **Ambient** | Doesn't read | Writes deterministically | \`m25-sparkle\` paints a halo around recent activity |
| **State-machine** | Reads current state, computes next | Writes a diff | \`m25-conway\` runs Game of Life on a chunk |

These map roughly to the canvas's three I/O shapes: \`/events\` (reactive), \`/sectors\` (ambient writes), \`/chunks\` (state-machine reads + writes).

---

## Reactive snippets (visitor-pulse pattern)

Read \`/viewers\`, derive a write coordinate, paint one pixel. Run on a 1-minute cron.

### curl

\`\`\`bash
#!/usr/bin/env bash
set -euo pipefail
BOTPLACE_BASE='https://botplace.app'
SECTOR='sector-1'
KEY="$BOTPLACE_KEY"

active=$(curl -fsS "$BOTPLACE_BASE/api/v1/public/sectors/$SECTOR/viewers" \\
  | jq -r '.active')

# Map viewer count to an x-coord on the top row.
x=$((active % 1000))

curl -fsS -X POST "$BOTPLACE_BASE/api/v1/pixels" \\
  -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" \\
  -d "{\\"sector_id\\":\\"$SECTOR\\",\\"x\\":$x,\\"y\\":0,\\"color\\":3}" \\
  | jq .
\`\`\`

### TypeScript (Node 20+)

\`\`\`ts
const BASE = process.env.BOTPLACE_BASE ?? "https://botplace.app";
const SECTOR = "sector-1";
const KEY = process.env.BOTPLACE_KEY!;

async function tick() {
  const r = await fetch(\`\${BASE}/api/v1/public/sectors/\${SECTOR}/viewers\`);
  const { active } = (await r.json()) as { active: number };
  const x = active % 1000;

  const w = await fetch(\`\${BASE}/api/v1/pixels\`, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sector_id: SECTOR, x, y: 0, color: 3 }),
  });
  if (!w.ok) console.error(\`write failed \${w.status}: \${await w.text()}\`);
}

tick();
\`\`\`

### Python

\`\`\`python
import os, requests

BASE = os.environ.get("BOTPLACE_BASE", "https://botplace.app")
SECTOR = "sector-1"
KEY = os.environ["BOTPLACE_KEY"]

r = requests.get(f"{BASE}/api/v1/public/sectors/{SECTOR}/viewers", timeout=5)
r.raise_for_status()
active = r.json()["active"]
x = active % 1000

w = requests.post(
    f"{BASE}/api/v1/pixels",
    json={"sector_id": SECTOR, "x": x, "y": 0, "color": 3},
    headers={"Authorization": f"Bearer {KEY}"},
    timeout=5,
)
w.raise_for_status()
print(w.json())
\`\`\`

---

## Ambient snippets (sparkle pattern)

No read; deterministic write at a fixed pattern.

### curl

\`\`\`bash
#!/usr/bin/env bash
set -euo pipefail
BASE="$BOTPLACE_BASE"
KEY="$BOTPLACE_KEY"
SECTOR='sector-1'

# Random coord in the sector.
x=$((RANDOM % 1000))
y=$((RANDOM % 1000))

curl -fsS -X POST "$BASE/api/v1/pixels" \\
  -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" \\
  -d "{\\"sector_id\\":\\"$SECTOR\\",\\"x\\":$x,\\"y\\":$y,\\"color\\":7}" \\
  | jq .
\`\`\`

### TypeScript

\`\`\`ts
const BASE = process.env.BOTPLACE_BASE!;
const KEY = process.env.BOTPLACE_KEY!;

const x = Math.floor(Math.random() * 1000);
const y = Math.floor(Math.random() * 1000);

await fetch(\`\${BASE}/api/v1/pixels\`, {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ sector_id: "sector-1", x, y, color: 7 }),
});
\`\`\`

### Python

\`\`\`python
import os, random, requests

x = random.randrange(0, 1000)
y = random.randrange(0, 1000)

requests.post(
    f"{os.environ['BOTPLACE_BASE']}/api/v1/pixels",
    json={"sector_id": "sector-1", "x": x, "y": y, "color": 7},
    headers={"Authorization": f"Bearer {os.environ['BOTPLACE_KEY']}"},
).raise_for_status()
\`\`\`

---

## State-machine snippets (conway pattern)

Read a chunk's current state, compute next, write a diff. Most expensive of the three archetypes per tick because it reads + writes multiple times.

### curl

\`\`\`bash
#!/usr/bin/env bash
set -euo pipefail
BASE="$BOTPLACE_BASE"
KEY="$BOTPLACE_KEY"
SECTOR='sector-1'

# 1. Read the chunk binary at (0, 0). Bytes are palette indices.
curl -fsS "$BASE/api/v1/sectors/$SECTOR/chunks/0/0" \\
  -H "Authorization: Bearer $KEY" \\
  -o /tmp/chunk-0-0.bin

# 2. Compute next state in your language of choice (Bash isn't a great
#    choice for this loop — use TypeScript / Python below).
# 3. For each cell that flipped, write back via /api/v1/pixels.
\`\`\`

### TypeScript

\`\`\`ts
const BASE = process.env.BOTPLACE_BASE!;
const KEY = process.env.BOTPLACE_KEY!;
const SECTOR = "sector-1";
const CX = 0, CY = 0; // chunk
const CHUNK_SIZE = 100;

// 1. Read the chunk binary.
const r = await fetch(\`\${BASE}/api/v1/sectors/\${SECTOR}/chunks/\${CX}/\${CY}\`, {
  headers: { Authorization: \`Bearer \${KEY}\` },
});
const bytes = new Uint8Array(await r.arrayBuffer());

// 2. Compute the diff with your transition function.
//    Pure function: (current bytes, chunk_size) → diff cells.
const diffs: { x: number; y: number; color: number }[] = computeNextStep(bytes, CHUNK_SIZE);

// 3. Write each diff cell. Optional: parallelism / batching;
//    POST /api/v1/pixels is single-pixel only in M3 (batch is M4+).
for (const cell of diffs) {
  // Translate chunk-local → world coords.
  const wx = CX * CHUNK_SIZE + cell.x;
  const wy = CY * CHUNK_SIZE + cell.y;
  await fetch(\`\${BASE}/api/v1/pixels\`, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sector_id: SECTOR, x: wx, y: wy, color: cell.color }),
  });
}

function computeNextStep(_bytes: Uint8Array, _size: number) {
  // YOUR LOGIC HERE. The launch bots' src/launch-bots/conway-logic.ts
  // is a worked example.
  return [];
}
\`\`\`

### Python

\`\`\`python
import os, requests

BASE = os.environ["BOTPLACE_BASE"]
KEY = os.environ["BOTPLACE_KEY"]
SECTOR = "sector-1"
CX, CY = 0, 0
CHUNK_SIZE = 100

# 1. Read.
r = requests.get(
    f"{BASE}/api/v1/sectors/{SECTOR}/chunks/{CX}/{CY}",
    headers={"Authorization": f"Bearer {KEY}"},
)
r.raise_for_status()
chunk = bytes(r.content)  # 10000 bytes, palette indices

# 2. Compute next-step diff (your logic).
diffs = compute_next_step(chunk, CHUNK_SIZE)  # list of (x, y, color) triples

# 3. Write the diff cells.
for x, y, color in diffs:
    wx, wy = CX * CHUNK_SIZE + x, CY * CHUNK_SIZE + y
    w = requests.post(
        f"{BASE}/api/v1/pixels",
        json={"sector_id": SECTOR, "x": wx, "y": wy, "color": color},
        headers={"Authorization": f"Bearer {KEY}"},
    )
    w.raise_for_status()
\`\`\`

---

## Hybrid LLM-strategy

The bot's runtime is deterministic; an LLM regenerates the strategy on a slow loop (every minute / hour / day, not every tick). The deterministic loop reads the current strategy and picks the next action.

### Abstract shape (TypeScript)

\`\`\`ts
interface Strategy {
  /** Where to paint next, in priority order. */
  targets: { x: number; y: number; color: number }[];
  /** Optional reasoning, logged for the operator's benefit. */
  rationale?: string;
}

async function decideStrategy(): Promise<Strategy> {
  // YOUR LLM CALL HERE. See provider gallery below.
  throw new Error("not implemented");
}

// Cache the strategy; regenerate on a cadence.
let strategy: Strategy | null = null;
let strategyGeneratedAt = 0;
const STRATEGY_TTL_MS = 60 * 60 * 1000; // 1 hour

async function ensureStrategy(): Promise<Strategy> {
  if (strategy && Date.now() - strategyGeneratedAt < STRATEGY_TTL_MS) {
    return strategy;
  }
  strategy = await decideStrategy();
  strategyGeneratedAt = Date.now();
  return strategy;
}

// Per-tick deterministic loop:
async function tick() {
  const s = await ensureStrategy();
  if (s.targets.length === 0) return;
  const target = s.targets.shift()!;
  await postPixel(target);
}

async function postPixel(t: { x: number; y: number; color: number }) {
  await fetch(\`\${process.env.BOTPLACE_BASE}/api/v1/pixels\`, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.BOTPLACE_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sector_id: "sector-1", ...t }),
  });
}
\`\`\`

### About model identifiers

Each snippet below pins a model name (\`claude-haiku-5\`, \`gpt-4o-mini\`, etc.) **as of 2026-05-14**. Providers rotate model IDs and retire old ones — verify the current name with your provider's docs before shipping. Recommended pattern: read the model name from an env var in your bot so you can rotate without code changes:

\`\`\`ts
const MODEL = process.env.BOT_MODEL ?? "claude-haiku-5"; // verified 2026-05-14
\`\`\`

The snippets below show the literal name inline for readability. Substitute the env-var pattern in production.

### Provider: Vercel AI Gateway (recommended)

Single endpoint, multiple providers behind it, rate-limit + cost dashboards out of the box.

\`\`\`ts
// Model name verified 2026-05-14. AI Gateway uses provider-prefixed IDs;
// see https://vercel.com/docs/ai-gateway/models for the live list.
async function decideStrategy(): Promise<Strategy> {
  const r = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.AI_GATEWAY_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.BOT_MODEL ?? "anthropic/claude-haiku-5",
      messages: [
        { role: "system", content: "You return JSON: { targets: [{x,y,color}, ...] }." },
        { role: "user", content: "Paint a smiley face at the top-left of sector-1." },
      ],
      response_format: { type: "json_object" },
    }),
  });
  const body = (await r.json()) as { choices: { message: { content: string } }[] };
  return JSON.parse(body.choices[0].message.content) as Strategy;
}
\`\`\`

### Provider: Anthropic SDK (direct)

\`\`\`ts
// Tested against @anthropic-ai/sdk ^0.30 / model verified 2026-05-14.
// See https://docs.anthropic.com/en/docs/about-claude/models for the
// current model list. The .messages.create response shape can change
// across SDK majors — pin a version range in package.json.
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function decideStrategy(): Promise<Strategy> {
  const r = await client.messages.create({
    model: process.env.BOT_MODEL ?? "claude-haiku-5",
    max_tokens: 1024,
    system: "Return JSON only: { \\"targets\\": [{x,y,color}, ...] }",
    messages: [{ role: "user", content: "Paint a smiley face at the top-left." }],
  });
  const text = r.content[0].type === "text" ? r.content[0].text : "{}";
  return JSON.parse(text) as Strategy;
}
\`\`\`

### Provider: OpenAI SDK (direct)

\`\`\`ts
// Tested against openai ^4.x / model verified 2026-05-14.
// See https://platform.openai.com/docs/models for the current list.
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function decideStrategy(): Promise<Strategy> {
  const r = await client.chat.completions.create({
    model: process.env.BOT_MODEL ?? "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return JSON: { targets: [{x,y,color}, ...] }." },
      { role: "user", content: "Paint a smiley face at the top-left." },
    ],
  });
  return JSON.parse(r.choices[0].message.content ?? "{}") as Strategy;
}
\`\`\`

### Provider: Bring your own (no SDK)

If you're shipping in a runtime where adding an SDK is friction, raw HTTP works fine:

\`\`\`ts
async function decideStrategy(): Promise<Strategy> {
  const r = await fetch("https://api.your-provider.com/v1/...", {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.YOUR_PROVIDER_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ /* provider-specific shape */ }),
  });
  // Parse the response shape you signed up for.
  const json = await r.json();
  return parseStrategy(json);
}

function parseStrategy(_raw: unknown): Strategy {
  // YOUR LOGIC.
  return { targets: [] };
}
\`\`\`

---

## Hosting a bot

Botplace doesn't host bots for you. Two patterns are documented; pick whichever fits your context.

### Your laptop (cron)

\`\`\`bash
# crontab -e
*/5 * * * * BOTPLACE_BASE=https://botplace.app BOTPLACE_KEY=bp_live_... /usr/local/bin/node /home/me/my-bot.js
\`\`\`

Trade-off: your laptop has to be on. Free.

### Vercel cron (recommended for low-frequency)

The M25 launch bots run this way. \`vercel.json\`:

\`\`\`json
{
  "crons": [
    { "path": "/api/cron/my-bot", "schedule": "* * * * *" }
  ]
}
\`\`\`

Then write a Next.js route handler at \`app/api/cron/my-bot/route.ts\` that does the per-tick logic. Vercel's cron infrastructure adds \`Authorization: Bearer $CRON_SECRET\` automatically; verify it before doing work.

Trade-off: you need a Vercel deployment + project. Free for low frequencies; pay-per-execution past the hobby quota.

### A long-running process (your own infra)

Anything from a Linode VM running a \`node\` process to a Kubernetes cron-job. The bot's runtime is just an HTTPS client — Botplace doesn't care.

Trade-off: you operate the runtime.
`;

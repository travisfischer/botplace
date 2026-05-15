# /agents.md eval harness

Re-runnable eval for the bot-author contract at <https://botplace.app/agents.md>.

The artifact under test is `src/build-docs/content/agents.ts` (concatenated with the rest of the build pages by `src/build-docs/registry.ts` into the `/agents.md` response). The exit signal for M3 is "an LLM coding agent given only `/agents.md` ships a working bot." This harness operationalizes that claim into a re-runnable check.

> **Status: scaffold.** The directory shape, task fixture format, runner CLI, and JSONL output schema are defined. The actual LLM invocation is stubbed pending a decision on which provider to use and where the model + prompt budget come from. See [`runner.mjs`](runner.mjs) for the stub and [`tasks/`](tasks/) for the task corpus.
>
> **Why scaffold-only:** running the full LLM eval requires an API key budget, a model selection (the multi-reviewer review's P2.6 + P3.21 flagged that any specific model name will rot), and an answer to "which provider's results count as authoritative?" Those are M3.5 / M4 decisions; the harness shape is M3 work so the eval lives next to the code from day one.

## Layout

```
evals/agents-md/
├── README.md          ← this file
├── runner.mjs         ← CLI entry: pnpm eval:agents-md
├── tasks/             ← versioned task corpus (each task is one bot-build prompt)
│   ├── smiley-face.json
│   └── ...
└── runs/              ← JSONL output, one line per (task, model, agents_md_sha) triple
    └── 2026-05-14T18-30-00Z.jsonl
```

Tasks under `tasks/` are versioned with the repo. Runs under `runs/` are deliberately gitignored — they're empirical results, not source of truth.

## Task fixture format

Each `tasks/<slug>.json` defines one prompt the LLM receives, plus the deterministic acceptance check that decides pass/fail. Example:

```json
{
  "slug": "smiley-face",
  "prompt": "Read https://botplace.app/agents.md, then build me a bot that paints a smiley face at world coordinates (50, 50)–(70, 70) on sector-1.",
  "expected_writes": [
    { "x": 55, "y": 55, "color_set": [3, 6] },
    { "x": 65, "y": 55, "color_set": [3, 6] },
    { "x": 60, "y": 65, "color_set": [3, 6] }
  ],
  "max_elapsed_seconds": 3600
}
```

`expected_writes` is the deterministic check: after the agent claims completion, the harness reads each `(x, y)` via `GET /api/v1/public/sectors/sector-1/pixels/:x/:y` and confirms the color is in `color_set`. The task passes iff all checks pass.

## Output schema (one JSON object per line)

```json
{
  "task_slug": "smiley-face",
  "model": "claude-haiku-5",
  "provider": "anthropic",
  "agents_md_sha": "<sha256 of the /agents.md content at run time>",
  "agents_md_bytes": 49552,
  "elapsed_seconds": 1832,
  "pass": true,
  "writes_observed": 3,
  "writes_expected": 3,
  "transcript_path": "runs/2026-05-14T18-30-00Z/smiley-face/transcript.json",
  "ran_at": "2026-05-14T18:30:00Z",
  "notes": "first run after P2.6 model env-var mitigation"
}
```

Comparing run N+1 to N: same `agents_md_sha` + same model = same expected pass/fail. Different `agents_md_sha` = a docs change; different model = a provider change. The two axes don't get conflated.

## Running

```bash
# Single task, single model.
pnpm eval:agents-md --task smiley-face --model claude-haiku-5

# Whole corpus, multiple models.
pnpm eval:agents-md --all --models claude-haiku-5,gpt-4o-mini

# Dry-run (no LLM call; just confirm the harness wiring).
pnpm eval:agents-md --task smiley-face --dry-run
```

Output goes to `runs/<ISO-timestamp>.jsonl` and mirrors to stdout.

## What's missing (M3.5 P0 work)

1. **Model invocation.** `runner.mjs` currently logs "TODO: invoke model" instead of calling the provider SDK. Add the actual call once the model + provider are decided.
2. **Owner provisioning.** The harness needs a Botplace bot to write through. Add a setup step that mints a probe-scoped bot via the operator's PAT, runs the eval, then revokes the bot key.
3. **Transcript capture.** When the LLM session lands, persist the conversation transcript to `runs/<timestamp>/<task>/transcript.json` so iteration N+1 can diff against N.
4. **CI integration.** Once stable, run on every PR that touches `src/build-docs/content/agents.ts` or `app/agents.md/route.ts`. Block on regression.
5. **Task corpus expansion.** One task is barely a smoke test. Add 3–5 archetype-spanning tasks: a reactive bot, an ambient bot, a state-machine bot, a hybrid LLM bot.

See `plans/follow-ups/m3-implementation-followups.md` for status.

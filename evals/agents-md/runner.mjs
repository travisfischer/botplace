#!/usr/bin/env node
// /agents.md eval harness runner.
//
// Status: scaffold. The LLM invocation is stubbed. The directory shape,
// task fixture format, JSONL output schema, and deterministic acceptance
// check (verify expected writes via /api/v1/public/sectors/:id/pixels/:x/:y)
// are all in place — fill in the model call when the provider is decided
// (M3.5 P0).
//
// Usage:
//   pnpm eval:agents-md --task smiley-face --model claude-haiku-5
//   pnpm eval:agents-md --all --models claude-haiku-5,gpt-4o-mini
//   pnpm eval:agents-md --task smiley-face --dry-run
//
// Output: JSONL to runs/<ISO-timestamp>.jsonl + mirrored to stdout.
// Each line is one (task, model, agents_md_sha) result.

import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const TASKS_DIR = path.join(SCRIPT_DIR, "tasks");
const RUNS_DIR = path.join(SCRIPT_DIR, "runs");

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    all: { type: "boolean", default: false },
    model: { type: "string" },
    models: { type: "string" }, // comma-separated for --all
    "dry-run": { type: "boolean", default: false },
    base: { type: "string", default: process.env.BOTPLACE_URL ?? "https://botplace.app" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  console.error(
    `usage: pnpm eval:agents-md [options]
  --task <slug>        run a single task from tasks/<slug>.json
  --all                run every task in tasks/
  --model <id>         model identifier (single-task mode)
  --models <a,b,c>     comma-separated model identifiers (--all mode)
  --dry-run            skip the LLM call; only verify wiring
  --base <url>         API base for acceptance checks (default $BOTPLACE_URL)
`,
  );
  process.exit(0);
}

if (!values.task && !values.all) {
  console.error("ERROR: pass --task <slug> or --all. See --help.");
  process.exit(2);
}

const taskSlugs = values.all
  ? readdirSync(TASKS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
  : [values.task];

const models = values.all
  ? (values.models ?? values.model ?? "").split(",").filter(Boolean)
  : [values.model].filter(Boolean);

if (models.length === 0 && !values["dry-run"]) {
  console.error("ERROR: no model specified. Pass --model or --models, or use --dry-run.");
  process.exit(2);
}
if (values["dry-run"] && models.length === 0) {
  models.push("dry-run");
}

mkdirSync(RUNS_DIR, { recursive: true });
const runStartedAt = new Date().toISOString().replace(/[:.]/g, "-");
const runOutPath = path.join(RUNS_DIR, `${runStartedAt}.jsonl`);

console.error(`Run id: ${runStartedAt}`);
console.error(`Output: ${runOutPath}`);
console.error(`Tasks: ${taskSlugs.join(", ")}`);
console.error(`Models: ${models.join(", ")}`);
console.error(`Base:   ${values.base}`);
console.error(values["dry-run"] ? "Mode:   DRY RUN (no LLM)" : "Mode:   LIVE");
console.error("");

// Fetch the current /agents.md so we can hash the artifact under test.
// In dry-run mode we still hash so the wire shape is exercised.
async function fetchAgentsMd(base) {
  const url = `${base.replace(/\/$/, "")}/agents.md`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ${url} → ${res.status}`);
  }
  return res.text();
}

const agentsMdText = await fetchAgentsMd(values.base);
const agentsMdSha = createHash("sha256").update(agentsMdText).digest("hex");
console.error(`agents.md sha256: ${agentsMdSha}`);
console.error(`agents.md bytes:  ${agentsMdText.length}`);
console.error("");

let totalRuns = 0;
let totalPasses = 0;

for (const slug of taskSlugs) {
  const taskPath = path.join(TASKS_DIR, `${slug}.json`);
  const task = JSON.parse(readFileSync(taskPath, "utf8"));
  for (const model of models) {
    totalRuns++;
    const startedAt = Date.now();

    let writesObserved = 0;
    let pass = false;

    try {
      if (values["dry-run"]) {
        // Skip the LLM. Just exercise the post-check wiring against the
        // existing canvas state. The check will likely fail because no
        // bot wrote at those coords during this dry run — that's
        // expected. The point is the harness ran end-to-end.
        const observed = await checkExpectedWrites(values.base, task);
        writesObserved = observed.matched;
        pass = false; // explicit: dry-run never passes
      } else {
        // TODO (M3.5): invoke the model.
        //
        // Recommended shape (provider-agnostic):
        //   1. Compose a session with task.prompt.
        //   2. Allow the model to call tools / run code in its sandbox
        //      (it needs to fetch /agents.md, mint a bot via the
        //      operator's PAT, then write pixels).
        //   3. Capture the transcript to runs/<runId>/<slug>/transcript.json.
        //   4. When the model claims completion, run checkExpectedWrites.
        //   5. Pass = all expected writes match within color_set.
        //
        // For now, this branch logs the gap and emits a "skipped" record
        // so the JSONL output schema is still well-formed.
        console.error(`[${slug} / ${model}] LLM invocation not yet implemented (scaffold).`);
        pass = false;
      }
    } catch (err) {
      console.error(`[${slug} / ${model}] error: ${err.message}`);
    }

    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    if (pass) totalPasses++;

    const record = {
      task_slug: slug,
      model,
      agents_md_sha: agentsMdSha,
      agents_md_bytes: agentsMdText.length,
      elapsed_seconds: elapsedSeconds,
      pass,
      writes_observed: writesObserved,
      writes_expected: task.expected_writes.length,
      ran_at: new Date().toISOString(),
      mode: values["dry-run"] ? "dry-run" : "live-stub",
    };

    const line = JSON.stringify(record);
    writeFileSync(runOutPath, line + "\n", { flag: "a" });
    console.log(line);
  }
}

console.error("");
console.error(`Done: ${totalPasses}/${totalRuns} passed.`);

if (totalRuns > 0 && totalPasses < totalRuns && !values["dry-run"]) {
  process.exit(1);
}

// Acceptance check: read each expected_writes coord via the public
// pixel endpoint; pass if the color is in color_set. Returns matched
// count (caller decides pass/fail vs total).
async function checkExpectedWrites(base, task) {
  let matched = 0;
  for (const expected of task.expected_writes) {
    const url = `${base.replace(/\/$/, "")}/api/v1/public/sectors/sector-1/pixels/${expected.x}/${expected.y}`;
    const res = await fetch(url);
    if (res.status === 404) continue; // no write at this coord
    if (!res.ok) continue;
    const body = await res.json();
    if (Array.isArray(expected.color_set) && expected.color_set.includes(body.color)) {
      matched++;
    } else if (expected.color !== undefined && body.color === expected.color) {
      matched++;
    }
  }
  return { matched };
}

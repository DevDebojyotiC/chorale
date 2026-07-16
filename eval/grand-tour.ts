/**
 * Grand tour — run one request through the whole Chorale pipeline and make every agent hand-off
 * unmistakable. It runs the orchestrator (which plan-firsts via the planner, then delegates each
 * step to a specialist), tees stderr to detect the hand-off markers the runtime already emits, and
 * prints an ordered summary of which agents actually fired.
 *
 * Usage:
 *   npx tsx eval/grand-tour.ts                       # the default grand-tour prompt
 *   npx tsx eval/grand-tour.ts "<your prompt>"       # a custom one
 *   npx tsx eval/grand-tour.ts --out ./somewhere "<prompt>"   # build into a chosen folder
 *
 * Needs provider credentials (it makes real model calls). Artifacts are written to a
 * project-local, gitignored folder — `grand-tour-output/run-<timestamp>/` by default (or the
 * `--out` dir) — and the path is printed at the end.
 */
import "dotenv/config";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { setLogLevel } from "../src/core/log.js";

// Full visibility: stream every agent (delegated + gated), banner each one as it starts, and
// surface every tool call / verify / gate step at debug level.
process.env.CHORALE_TRACE = "1";
setLogLevel("debug");

const DEFAULT_PROMPT =
  "Do this as one project, in order: " +
  "1) Research the most-funded AI developer-tools startup announced in 2026 and its headline funding figure. " +
  "2) Decide a simple data model for a 'startup' record (choose the fields and types). " +
  "3) Build a small, runnable single-file Node.js script that holds a few example startups (including the researched one) and prints them sorted by funding. " +
  "4) Write tests for that script and run them. " +
  "5) Review the script for correctness and security. " +
  "6) Produce a one-page executive-summary PDF of the finding and the tool.";

// Args: an optional `--out <dir>` (where to build), the rest joined is the prompt.
const rawArgs = process.argv.slice(2);
let outDir = "";
const promptArgs: string[] = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--out") {
    outDir = rawArgs[++i] ?? "";
    continue;
  }
  promptArgs.push(rawArgs[i]!);
}
const prompt = promptArgs.join(" ").trim() || DEFAULT_PROMPT;

// The agents a full tour should exercise, in the order they typically fire.
const TARGETS = ["orchestrator", "planner", "research", "coder", "test-writer", "reviewer", "scribe"];

const t0 = Date.now();
const order: string[] = []; // agents in the order first seen
const timeline: string[] = []; // human-readable hand-off markers, in order
const note = (agent: string, marker: string): void => {
  if (!order.includes(agent)) order.push(agent);
  timeline.push(`  ${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s  ${marker}`);
};

// Tee stderr: pass everything through untouched, but scan for the hand-off markers the runtime
// already prints ([delegate → X], plan-first, review gate, docs grounded, …).
const realErr = process.stderr.write.bind(process.stderr);
const scan = (s: string): void => {
  const d = s.match(/\[delegate → ([a-z-]+)\]/);
  if (d) note(d[1]!, `orchestrator ── delegates ──▶ ${d[1]}`);
  if (/plan valid|plan-first: injected/.test(s)) note("planner", "planner ✓ produced a grounded plan (pre-gate)");
  if (/✓ code verified|code verified \+ ran clean/.test(s)) note("coder", "coder ✓ code verified + ran clean");
  if (/review gate: no blocking|review gate: \d+ blocking/.test(s)) note("reviewer", "reviewer ✓ review gate ran");
  if (/docs grounded/.test(s)) note("scribe", "scribe ✓ docs grounded");
};
(process.stderr as unknown as { write: (c: unknown, ...a: unknown[]) => boolean }).write = (chunk: unknown, ...a: unknown[]): boolean => {
  try {
    scan(typeof chunk === "string" ? chunk : String(chunk));
  } catch {
    /* never let the tap break output */
  }
  return realErr(chunk as string, ...(a as []));
};

process.stdout.write(
  `\n${"═".repeat(78)}\n` +
    `  CHORALE — GRAND TOUR\n` +
    `${"═".repeat(78)}\n` +
    `  A single request routed through the whole pipeline. Expected hand-offs:\n` +
    `    orchestrator ▸ planner (plan-first) ▸ research ▸ coder ▸ test-writer ▸ reviewer ▸ scribe\n` +
    `  (the coder also runs the reviewer as an automatic post-verify gate)\n` +
    `  FULL-VISIBILITY TRACE is on: every agent streams live, banners mark each start,\n` +
    `  and every tool call / verify / gate step is shown (debug level).\n\n` +
    `  Prompt:\n    ${prompt.replace(/\. (\d\)) /g, ".\n    $1 ")}\n` +
    `${"─".repeat(78)}\n\n`,
);

const origCwd = process.cwd();
const config = loadConfig();
config.agents.dir = resolve(origCwd, config.agents.dir); // absolutize before we change cwd
const registry = buildRegistry(config);
const orchestrator = loadAgent(join(config.agents.dir, "orchestrator.md"));

// Build into a project-local, gitignored folder so the output is easy to find. Each run gets
// its own timestamped subfolder. Override with `--out <dir>` (already stripped from the prompt).
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); // e.g. 2026-07-16T17-30-00
const workdir = outDir ? resolve(origCwd, outDir) : resolve(origCwd, "grand-tour-output", `run-${stamp}`);
mkdirSync(workdir, { recursive: true });
note("orchestrator", "orchestrator ◀ received the request (entry point)");

let failed = "";
try {
  process.chdir(workdir); // specialists write their files here — keeps your repo clean
  await runAgent({ config, registry, agent: orchestrator, prompt, permissionMode: "full-auto", stream: true });
} catch (e) {
  failed = e instanceof Error ? e.message : String(e);
} finally {
  process.chdir(origCwd);
  (process.stderr as unknown as { write: typeof realErr }).write = realErr; // restore
}

// ── Summary ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n\n${"═".repeat(78)}\n  GRAND TOUR — SUMMARY\n${"═".repeat(78)}\n`);
if (failed) {
  process.stdout.write(
    `  ✗ The run did not complete: ${failed.split("\n")[0]}\n` +
      (/fallback chain failed|Unauthorized|API key/i.test(failed)
        ? `  → This is a provider-credentials issue, not a pipeline bug. Set your keys (.env) and re-run.\n`
        : ``),
  );
}
process.stdout.write(`\n  Hand-off timeline:\n${timeline.join("\n") || "    (none captured)"}\n`);
process.stdout.write(`\n  Agents exercised (${order.length}/${TARGETS.length}):\n`);
for (const a of TARGETS) {
  const hit = order.includes(a);
  process.stdout.write(`    ${hit ? "✓" : "·"} ${a}${hit ? "" : "  (not reached)"}\n`);
}
const missed = TARGETS.filter((a) => !order.includes(a));
process.stdout.write(
  `\n  ${missed.length === 0 ? "✓ Full tour — every agent fired." : `Reached ${order.length}/${TARGETS.length}; missed: ${missed.join(", ")}.`}\n` +
    `  Elapsed: ${Math.round((Date.now() - t0) / 1000)}s\n` +
    `  Artifacts: ${workdir}\n${"═".repeat(78)}\n`,
);
process.exit(0);

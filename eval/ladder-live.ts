/**
 * Live exercise of the repair ladder's upper rungs (Phase 4 · escalate-last).
 *
 * The natural fullstack run solved its failure at the cheapest (playbook) rung — good, but it left the
 * research and escalate rungs proven only by unit tests. This harness drives the ladder end-to-end with
 * REAL model calls so we can watch the middle and top rungs fire live:
 *   • a real, small broken project on disk (a logic bug the static gates can't see),
 *   • a real coder attempt at each rung, a real research-agent delegation for the middle rung, and a
 *     real escalation to the stronger model at the top,
 *   • write-back of the winning fix into the playbook.
 *
 * To GUARANTEE the climb (rather than hope the cheap model keeps failing), the re-check is controlled:
 * it reports the issue as unresolved until the *escalated* attempt has run. Everything else — the agent
 * calls, the model switch, the findings hand-off, the learned entry — is real. This is a plumbing/
 * integration proof of the upper rungs, complementary to the natural single-rung solve.
 *
 *   npx tsx eval/ladder-live.ts
 */
import "dotenv/config";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { resolveModelPlan } from "../src/core/model-policy.js";
import { runRepairLadder } from "../src/core/repair.js";
import { Playbook } from "../src/core/playbook.js";
import { seedPlaybook } from "../src/core/playbook-seed.js";
import { setLogLevel } from "../src/core/log.js";

setLogLevel("debug");
process.env.CHORALE_TRACE = "1";
// Keep each rung a single focused call — no post-verify review gate / self-critique noise or cost.
process.env.CHORALE_NO_REVIEW_GATE = "1";
process.env.CHORALE_NO_CRITIQUE = "1";
process.env.CHORALE_NO_GATES = "1";

const say = (s: string): void => void process.stdout.write(s + "\n");

const origCwd = process.cwd();
const config = loadConfig();
config.agents.dir = resolve(origCwd, config.agents.dir);
const registry = buildRegistry(config);

const coderModel = resolveModelPlan(loadAgent(join(config.agents.dir, "coder.md")), config).model;
const escalatedModel = resolveModelPlan(loadAgent(join(config.agents.dir, "coder.md")), config).fallbacks[0];
say(`\n${"═".repeat(78)}\n  REPAIR LADDER — LIVE (upper rungs)\n${"═".repeat(78)}`);
say(`  cheap model:     ${coderModel}`);
say(`  escalate model:  ${escalatedModel ?? "(none configured!)"}\n`);

// A real, small broken project: /api/notes returns notes in insertion order, not newest-first.
const workdir = resolve(origCwd, "experiments", "ladder-live");
rmSync(workdir, { recursive: true, force: true });
mkdirSync(workdir, { recursive: true });
writeFileSync(
  join(workdir, "package.json"),
  JSON.stringify({ name: "notes-live", type: "module", scripts: { start: "node server.js" }, dependencies: { express: "^4" } }, null, 2),
);
writeFileSync(
  join(workdir, "server.js"),
  `import express from "express";
const app = express();
const notes = [
  { id: 1, title: "first", createdAt: "2026-01-01T00:00:00Z" },
  { id: 2, title: "second", createdAt: "2026-03-01T00:00:00Z" },
  { id: 3, title: "third", createdAt: "2026-02-01T00:00:00Z" },
];
// BUG: returns notes in insertion order instead of newest-first by createdAt.
app.get("/api/notes", (_req, res) => res.json(notes));
app.listen(process.env.PORT || 3000);
`,
);

const ISSUE = "GET /api/notes returns notes in insertion order; they must be sorted newest-first by createdAt (descending), so the note with the latest createdAt comes first. Fix the endpoint in server.js.";

const runSpecialist = async (agentName: string, task: string, escalate: boolean): Promise<{ ok: boolean; text: string }> => {
  const spec = loadAgent(join(config.agents.dir, `${agentName}.md`));
  const modelOverride = escalate ? resolveModelPlan(spec, config).fallbacks[0] : undefined;
  if (modelOverride) say(`  ⤴ escalating ${agentName} → ${modelOverride}`);
  try {
    const res = await runAgent({ config, registry, agent: spec, prompt: task, modelOverride, permissionMode: "full-auto", stream: true });
    return { ok: true, text: res.text };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) };
  }
};

// Controlled re-check: unresolved until the escalated attempt has run (forces the full climb).
let lastLevel = "";
const recheck = (): string[] => (lastLevel === "escalated" ? [] : [ISSUE]);

const pbPath = join(workdir, "playbook.json");
const pb = new Playbook(pbPath);
seedPlaybook(pb, Date.now());
say(`  seeded playbook: ${pb.entries().length} entries\n${"─".repeat(78)}\n`);

process.chdir(workdir);
const result = await runRepairLadder([ISSUE], {
  attempt: async ({ instruction, escalate, level }) => {
    lastLevel = level;
    say(`\n${"·".repeat(4)} RUNG: ${level}${escalate ? " (escalated model)" : ""} ${"·".repeat(40)}`);
    return runSpecialist("coder", instruction, escalate);
  },
  recheck,
  model: coderModel,
  escalateModel: escalatedModel,
  kind: "logic",
  hasResearch: true,
  research: async ({ issues }) => {
    say(`\n${"·".repeat(4)} RESEARCH DELEGATION ${"·".repeat(40)}`);
    const r = await runSpecialist("research", `A code bug persists after a first fix attempt. Investigate and return CONCRETE guidance the coder can apply (correct approach + exact change). Do NOT write files.\n\nIssue:\n- ${issues.join("\n- ")}`, false);
    return r.ok ? r.text : "";
  },
  canEscalate: true,
  playbook: pb,
  project: "ladder-live",
  step: "logic",
  now: () => Date.now(),
  log: (m) => say(`  ↳ ${m}`),
});
process.chdir(origCwd);

say(`\n${"═".repeat(78)}\n  RESULT\n${"═".repeat(78)}`);
say(`  solved:   ${result.solved}`);
say(`  rungs:    ${result.rungs.map((r) => `${r.level}${r.solved ? "✓" : "✗"}`).join(" → ")}`);
const learned = pb.entries().filter((e) => e.source !== "seeded");
say(`  learned:  ${learned.length} new entry(ies) written back`);
for (const e of learned) say(`    • [${e.source}] ${e.title}\n        solution: ${e.solution.slice(0, 120)}…`);
say(`  artifacts: ${workdir}\n${"═".repeat(78)}`);

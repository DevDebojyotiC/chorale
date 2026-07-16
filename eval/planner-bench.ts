/**
 * Planner benchmark: run the `planner` agent over the fixture goals and score each produced
 * plan with the objective graders (complexity, completeness, delegation, structure). Each goal
 * runs in its own temp copy of the fixture's synthetic repo so the planner's read tools and the
 * grounding check see real files. One model call per fixture.
 *
 * Usage: npx tsx eval/planner-bench.ts ["<provider:model>" ...]
 *   (no args → the planner's default model)
 *
 * Needs provider credentials; with none, every model in the chain fails auth and the run
 * reports "model unavailable" per fixture (the deterministic proof is planner-selftest.ts).
 */
import "dotenv/config";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { FIXTURES, gradePlan, writeRepo, type PlanGrade } from "./planner-fixtures.js";

process.env.CHORALE_NO_LEARN = "1"; // reproducible: no lesson injection/capture

const models = process.argv.slice(2);
const origCwd = process.cwd();
const config = loadConfig();
const registry = buildRegistry(config);
const planner = loadAgent(resolve(origCwd, "agents/planner.md"));

async function runModel(modelRef: string | undefined): Promise<void> {
  const label = modelRef ?? planner.model;
  process.stdout.write(`\n========== planner · ${label} ==========\n`);
  const grades: PlanGrade[] = [];

  for (const fx of FIXTURES) {
    const dir = mkdtempSync(join(tmpdir(), `chorale-plannerbench-${fx.id}-`));
    writeRepo(dir, fx.repo);
    let line: string;
    try {
      process.chdir(dir); // the planner grounds against this repo (its tools + the validator use cwd)
      const res = await runAgent({ config, registry, agent: planner, prompt: fx.goal, modelOverride: modelRef, permissionMode: "read-only", stream: false });
      if (!res.plan) {
        line = `${fx.id.padEnd(16)} — no plan produced (model unavailable or emitted none)`;
      } else {
        const g = gradePlan(fx, res.plan, { cwd: dir });
        grades.push(g);
        const marks = [
          g.complexityOk ? "cx✓" : "cx✗",
          `cover ${Math.round(g.completeness * 100)}%`,
          g.delegationOk ? "deleg✓" : "deleg✗",
          g.structureOk ? "struct✓" : `struct✗(${g.issues})`,
        ].join(" · ");
        line = `${fx.id.padEnd(16)} ${g.pass ? "✓ PASS" : "✗ fail"}  [${marks}]  ${res.plan.steps.length} steps`;
      }
    } catch (e) {
      line = `${fx.id.padEnd(16)} — errored: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      process.chdir(origCwd);
      rmSync(dir, { recursive: true, force: true });
    }
    process.stdout.write(`  ${line}\n`);
  }

  if (grades.length > 0) {
    const passed = grades.filter((g) => g.pass).length;
    const avgCover = Math.round((grades.reduce((n, g) => n + g.completeness, 0) / grades.length) * 100);
    process.stdout.write(`  ──\n  ${passed}/${grades.length} plans pass · avg layer coverage ${avgCover}%\n`);
  } else {
    process.stdout.write(`  ──\n  no gradable plans (provider credentials likely missing — see planner-selftest.ts for the deterministic proof)\n`);
  }
}

for (const m of models.length > 0 ? models : [undefined]) {
  await runModel(m);
}
process.exit(0);

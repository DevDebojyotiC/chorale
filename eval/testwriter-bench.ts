/**
 * Test-writer benchmark: give the `test-writer` agent a module + spec, have it write a suite, then
 * grade that suite by MUTATION — it must pass on the correct code and fail on every planted mutant.
 * Each fixture runs in its own temp dir containing the correct `target.mjs`; the agent reads it and
 * writes `target.test.mjs`.
 *
 * Usage: npx tsx eval/testwriter-bench.ts ["<provider:model>" ...]
 *   (no args → the test-writer's default model)
 *
 * Needs provider credentials; with none, the run reports "no suite produced" per fixture (the
 * deterministic proof is testwriter-selftest.ts).
 */
import "dotenv/config";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { FIXTURES, gradeTests, MODULE_FILE, TEST_FILE, type TWGrade } from "./testwriter-fixtures.js";

process.env.CHORALE_NO_LEARN = "1"; // reproducible

const models = process.argv.slice(2);
const origCwd = process.cwd();
const config = loadConfig();
const registry = buildRegistry(config);
const agent = loadAgent(resolve(origCwd, "agents/test-writer.md"));

function prompt(fx: (typeof FIXTURES)[number]): string {
  return (
    `The module \`${MODULE_FILE}\` in this directory exports \`${fx.exportName}\`. ${fx.spec}\n\n` +
    `Read ${MODULE_FILE}, then write a thorough test suite to \`${TEST_FILE}\` that imports from "./${MODULE_FILE}", ` +
    `and run it with \`node --test ${TEST_FILE}\` until it passes. Cover the happy path, edges, and error cases.`
  );
}

async function runModel(modelRef: string | undefined): Promise<void> {
  const label = modelRef ?? agent.model;
  process.stdout.write(`\n========== test-writer · ${label} ==========\n`);
  const grades: TWGrade[] = [];

  for (const fx of FIXTURES) {
    const dir = mkdtempSync(join(tmpdir(), `chorale-twbench-${fx.id}-`));
    writeFileSync(join(dir, MODULE_FILE), fx.correct, "utf8");
    let line: string;
    try {
      process.chdir(dir);
      await runAgent({ config, registry, agent, prompt: prompt(fx), modelOverride: modelRef, permissionMode: "full-auto", stream: false });
      const testPath = join(dir, TEST_FILE);
      if (!existsSync(testPath)) {
        line = `${fx.id.padEnd(12)} — no suite produced (model unavailable or wrote no test file)`;
      } else {
        const g = gradeTests(fx, readFileSync(testPath, "utf8"));
        grades.push(g);
        line = `${fx.id.padEnd(12)} ${g.good ? "✓ GOOD" : "✗ weak"}  [clean ${g.cleanPass ? "✓" : "✗"} · kill ${g.killed.length}/${fx.mutants.length}${g.survived.length ? ` · survived: ${g.survived.join(",")}` : ""}]`;
      }
    } catch (e) {
      line = `${fx.id.padEnd(12)} — errored: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      process.chdir(origCwd);
      rmSync(dir, { recursive: true, force: true });
    }
    process.stdout.write(`  ${line}\n`);
  }

  if (grades.length > 0) {
    const good = grades.filter((g) => g.good).length;
    const totalMut = grades.reduce((n, g) => n + g.killed.length + g.survived.length, 0);
    const killed = grades.reduce((n, g) => n + g.killed.length, 0);
    process.stdout.write(`  ──\n  ${good}/${grades.length} suites good · overall mutation kill rate ${totalMut ? Math.round((killed / totalMut) * 100) : 0}%\n`);
  } else {
    process.stdout.write(`  ──\n  no gradable suites (provider credentials likely missing — see testwriter-selftest.ts)\n`);
  }
}

for (const m of models.length > 0 ? models : [undefined]) {
  await runModel(m);
}
process.exit(0);

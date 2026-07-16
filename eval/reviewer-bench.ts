/**
 * Reviewer benchmark: run the `reviewer` agent over the planted-defect fixtures
 * and score RECALL (planted defects caught) + PRECISION (no false BLOCKER/MAJOR
 * on the clean control). Code is inlined into the prompt so this measures review
 * QUALITY, not tool-use — one model call per fixture, read-only, credit-light.
 *
 * Usage: npx tsx eval/reviewer-bench.ts ["<provider:model>" ...]
 *   (no args → the reviewer's default model)
 */
import "dotenv/config";
import { resolve } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { FIXTURES, gradeReview, numberedCode, type ReviewGrade } from "./reviewer-fixtures.js";

process.env.CHORALE_NO_LEARN = "1"; // reproducible: no lesson injection/capture
process.env.CHORALE_NO_CRITIQUE = "1"; // measure raw single-pass ability (critique isolated in the A/B harness)

const models = process.argv.slice(2);
const config = loadConfig();
const registry = buildRegistry(config);
const reviewer = loadAgent(resolve(process.cwd(), "agents/reviewer.md"));

function prompt(code: string, lang: string): string {
  return (
    `Review the following ${lang} code. Report findings in your exact format and end with a VERDICT.\n\n` +
    "```" +
    `${lang}\n${numberedCode(code)}\n` +
    "```"
  );
}

async function runModel(modelRef: string | undefined): Promise<void> {
  const label = modelRef ?? reviewer.model;
  process.stdout.write(`\n========== reviewer · ${label} ==========\n`);
  const grades: ReviewGrade[] = [];
  const t0 = Date.now();

  for (const f of FIXTURES) {
    const res = await runAgent({
      config,
      registry,
      agent: reviewer,
      prompt: prompt(f.code, f.lang),
      modelOverride: modelRef,
      permissionMode: "read-only", // static review — no tools needed, code is inline
      stream: false,
    });
    const g = gradeReview(f, res.text);
    grades.push(g);
    const mark = f.clean ? (g.falseBlockers === 0 ? "✓ clean" : `✗ ${g.falseBlockers} false BLOCKER/MAJOR`) : g.missed.length === 0 ? `✓ caught ${g.caught.join(",")}` : `✗ missed ${g.missed.join(",")}`;
    process.stdout.write(`  ${f.id.padEnd(18)} ${mark}  [verdict: ${g.verdict ?? "—"}]\n`);
  }

  const defects = grades.filter((g) => !g.clean);
  const caught = defects.reduce((n, g) => n + g.caught.length, 0);
  const total = defects.reduce((n, g) => n + (g.caught.length + g.missed.length), 0);
  const cleanG = grades.filter((g) => g.clean);
  const falsePos = cleanG.reduce((n, g) => n + g.falseBlockers, 0);
  const secs = Math.round((Date.now() - t0) / 1000);
  process.stdout.write(
    `  ── recall ${caught}/${total} defects · precision ${cleanG.length - cleanG.filter((g) => g.falseBlockers > 0).length}/${cleanG.length} clean (${falsePos} false severe) · ${secs}s\n`,
  );
}

for (const m of models.length ? models : [undefined]) {
  await runModel(m);
}
process.exit(0);

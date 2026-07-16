/**
 * A/B ablation for the reviewer's self-critique pass (its form of self-healing):
 * runs each fixture single-pass vs. with the critique pass and reports the delta in
 * recall (defects caught) and precision (no false BLOCKER/MAJOR on correct code).
 *
 * Usage: npx tsx eval/reviewer-critique-ab.ts <precision|expert|multi|all> ["<model>"] [iterations]
 *   defaults: expert suite · gemma-4-31B · 1 iteration
 */
import "dotenv/config";
import { resolve } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { gradeReview, numberedCode, type Fixture } from "./reviewer-fixtures.js";
import { PRECISION, MULTI, EXPERT } from "./reviewer-suites.js";

process.env.CHORALE_NO_LEARN = "1";

const SUITES: Record<string, Fixture[]> = { precision: PRECISION, multi: MULTI, expert: EXPERT, all: [...EXPERT, ...PRECISION] };
const which = process.argv[2] ?? "expert";
const model = process.argv[3] ?? "hf:google/gemma-4-31B-it";
const iters = Number(process.argv[4] ?? "1");
const fixtures = SUITES[which] ?? EXPERT;

const config = loadConfig();
const registry = buildRegistry(config);
const reviewer = loadAgent(resolve(process.cwd(), "agents/reviewer.md"));

async function score(fixtures: Fixture[], useCritique: boolean): Promise<{ recall: number; totalDefects: number; falsePos: number; cleans: number }> {
  process.env.CHORALE_NO_CRITIQUE = useCritique ? "0" : "1";
  let recall = 0, totalDefects = 0, falsePos = 0, cleans = 0;
  for (const f of fixtures) {
    const res = await runAgent({
      config, registry, agent: reviewer,
      prompt: `Review the following ${f.lang} code. Report findings in your exact format and end with a VERDICT.\n\n\`\`\`${f.lang}\n${numberedCode(f.code)}\n\`\`\``,
      modelOverride: model, permissionMode: "read-only", stream: false,
    });
    const g = gradeReview(f, res.text);
    if (f.clean) { cleans++; if (g.falseBlockers > 0) falsePos++; }
    else { recall += g.caught.length; totalDefects += f.defects.length; }
  }
  return { recall, totalDefects, falsePos, cleans };
}

process.stdout.write(`\n===== self-critique A/B · ${which} · ${model} · ${iters} iter(s) =====\n`);
for (let i = 1; i <= iters; i++) {
  const off = await score(fixtures, false);
  const on = await score(fixtures, true);
  const line = (label: string, s: typeof off): string =>
    `  ${label}: recall ${s.recall}/${s.totalDefects} · false-positives ${s.falsePos}/${s.cleans} clean`;
  process.stdout.write(`iter ${i}\n${line("single-pass ", off)}\n${line("+ critique  ", on)}\n`);
}
process.exit(0);

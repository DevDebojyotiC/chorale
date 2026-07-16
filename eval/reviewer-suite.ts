/**
 * Comprehensive reviewer runner across suites: precision (false-positive
 * resistance), multi (find-them-all recall), polyglot (non-JS). Reports the
 * metric that matters per suite.
 *
 * Usage: npx tsx eval/reviewer-suite.ts <precision|multi|polyglot|all> ["<model>" ...]
 *   (no models → gemma-4-31B + gpt-oss-120B)
 */
import "dotenv/config";
import { resolve } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { gradeReview, numberedCode, type Fixture } from "./reviewer-fixtures.js";
import { PRECISION, MULTI, POLYGLOT, EXPERT } from "./reviewer-suites.js";

process.env.CHORALE_NO_LEARN = "1"; // single-pass base measurement
process.env.CHORALE_NO_CRITIQUE = "1";

const SUITES: Record<string, Fixture[]> = { precision: PRECISION, multi: MULTI, polyglot: POLYGLOT, expert: EXPERT };
const which = process.argv[2] ?? "all";
const rest = process.argv.slice(3);
const models = rest.length ? rest : ["hf:google/gemma-4-31B-it", "fireworks:accounts/fireworks/models/gpt-oss-120b"];
const chosen = which === "all" ? Object.keys(SUITES) : [which];

const config = loadConfig();
const registry = buildRegistry(config);
const reviewer = loadAgent(resolve(process.cwd(), "agents/reviewer.md"));

function prompt(f: Fixture): string {
  return (
    `Review the following ${f.lang} code. Report findings in your exact format and end with a VERDICT.\n\n` +
    "```" +
    `${f.lang}\n${numberedCode(f.code)}\n` +
    "```"
  );
}

async function review(f: Fixture, modelRef: string): Promise<string> {
  const res = await runAgent({
    config,
    registry,
    agent: reviewer,
    prompt: prompt(f),
    modelOverride: modelRef,
    permissionMode: "read-only",
    stream: false,
  });
  return res.text;
}

for (const suite of chosen) {
  const fixtures = SUITES[suite]!;
  for (const modelRef of models) {
    process.stdout.write(`\n===== ${suite.toUpperCase()} · ${modelRef} =====\n`);
    const t0 = Date.now();
    let goodCleans = 0;
    let caught = 0;
    let totalDefects = 0;
    for (const f of fixtures) {
      const g = gradeReview(f, await review(f, modelRef));
      if (f.clean) {
        const ok = g.falseBlockers === 0;
        if (ok) goodCleans++;
        process.stdout.write(`  ${f.id.padEnd(22)} ${ok ? "✓ no false alarm" : `✗ ${g.falseBlockers} false BLOCKER/MAJOR`}  [${g.verdict ?? "—"}]\n`);
      } else {
        caught += g.caught.length;
        totalDefects += f.defects.length;
        const ok = g.missed.length === 0;
        process.stdout.write(`  ${f.id.padEnd(22)} ${ok ? "✓" : "✗"} ${g.caught.length}/${f.defects.length}${g.missed.length ? ` (missed ${g.missed.join(",")})` : ""}  [${g.verdict ?? "—"}]\n`);
      }
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    if (suite === "precision") process.stdout.write(`  ── precision ${goodCleans}/${fixtures.length} clean (no false BLOCKER/MAJOR) · ${secs}s\n`);
    else process.stdout.write(`  ── recall ${caught}/${totalDefects} defects · ${secs}s\n`);
  }
}
process.exit(0);

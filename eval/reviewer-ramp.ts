/**
 * Reviewer difficulty ramp: 10 planted defects of increasing subtlety (L1 easiest
 * to spot → L10 subtlest). Runs the `reviewer` agent over all 10 levels for each
 * model and reports which defects it catches, its "ceiling" (highest level with an
 * unbroken catch streak from L1), and total recall. Same idea as the coder ramp,
 * but the axis is how hard the bug is to SEE.
 *
 * Code is inlined (read-only, no tools) so this measures review quality directly.
 * One model call per level → 10 calls/model.
 *
 * Usage: npx tsx eval/reviewer-ramp.ts ["<provider:model>" ...]
 *   (no args → gemma-4-31B and gpt-oss-120B)
 */
import "dotenv/config";
import { resolve } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { RAMP, gradeReview, numberedCode } from "./reviewer-fixtures.js";

process.env.CHORALE_NO_LEARN = "1"; // single-pass base measurement
process.env.CHORALE_NO_CRITIQUE = "1"; // reproducible: no lesson injection/capture

const DEFAULT_MODELS = ["hf:google/gemma-4-31B-it", "fireworks:accounts/fireworks/models/gpt-oss-120b"];
const models = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_MODELS;

const config = loadConfig();
const registry = buildRegistry(config);
const reviewer = loadAgent(resolve(process.cwd(), "agents/reviewer.md"));
const levels = [...RAMP].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));

function prompt(code: string, lang: string): string {
  return (
    `Review the following ${lang} code. Report findings in your exact format and end with a VERDICT.\n\n` +
    "```" +
    `${lang}\n${numberedCode(code)}\n` +
    "```"
  );
}

interface Row {
  level: number;
  id: string;
  caught: boolean;
  verdict: string | null;
}

async function runModel(modelRef: string): Promise<void> {
  process.stdout.write(`\n========== reviewer ramp · ${modelRef} ==========\n`);
  const rows: Row[] = [];
  const t0 = Date.now();

  for (const f of levels) {
    const res = await runAgent({
      config,
      registry,
      agent: reviewer,
      prompt: prompt(f.code, f.lang),
      modelOverride: modelRef,
      permissionMode: "read-only",
      stream: false,
    });
    const g = gradeReview(f, res.text);
    const caught = g.caught.length === 1;
    rows.push({ level: f.level!, id: f.id, caught, verdict: g.verdict });
    process.stdout.write(
      `  L${String(f.level).padStart(2, "0")}  ${caught ? "✓" : "✗"}  ${f.id.padEnd(24)} ${caught ? "caught" : "MISSED"}  [verdict: ${g.verdict ?? "—"}]  — ${f.difficulty}\n`,
    );
  }

  // Ceiling: highest level with an unbroken catch streak from L1.
  let ceiling = 0;
  for (const r of rows) {
    if (r.caught && r.level === ceiling + 1) ceiling = r.level;
    else break;
  }
  const total = rows.filter((r) => r.caught).length;
  const missed = rows.filter((r) => !r.caught).map((r) => `L${r.level}`);
  const secs = Math.round((Date.now() - t0) / 1000);
  process.stdout.write(
    `  ── ceiling L${ceiling}/10 · recall ${total}/10${missed.length ? ` · missed ${missed.join(",")}` : " · PERFECT"} · ${secs}s\n`,
  );
}

for (const m of models) {
  await runModel(m);
}
process.exit(0);

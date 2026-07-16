/**
 * Tier-3 (design mode) live benchmark: ask the scribe to AUTHOR a bespoke, polished HTML
 * report from a source, and grade it on BOTH axes that matter — design richness
 * (scoreDesign, /8) and grounded fidelity (no fabricated data numbers vs the source).
 * That pairing is scribe's edge: Claude-grade polish, but verified never to invent data.
 *
 * Usage: npx tsx eval/scribe-design-bench.ts ["<provider:model>" ...]
 */
import "dotenv/config";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { checkDesignFidelity } from "../src/core/ground.js";
import { scoreDesign } from "./scribe-design.js";

process.env.CHORALE_NO_LEARN = "1";

const models = process.argv.slice(2).length ? process.argv.slice(2) : ["hf:google/gemma-4-31B-it", "fireworks:accounts/fireworks/models/gpt-oss-120b"];
const repoRoot = process.cwd();
const config = loadConfig();
config.agents.dir = resolve(repoRoot, config.agents.dir);
const registry = buildRegistry(config);
const scribe = loadAgent(resolve(repoRoot, "agents/scribe.md"));

const SOURCE = `# Q3 Model Benchmark

Three models were evaluated on 12 tasks.

| Model | Score | Cost |
|-------|------:|-----:|
| Gemma-4-31B | 9 | 0 |
| gpt-oss-120B | 10 | 13 |
| MiniMax-M2.7 | 8 | 25 |

Gemma is the value pick; gpt-oss is the reliability champion.
`;

for (const model of models) {
  const dir = mkdtempSync(join(tmpdir(), "chorale-design-"));
  writeFileSync(join(dir, "source.md"), SOURCE);
  process.stdout.write(`\n===== design mode · ${model} =====\n`);
  try {
    process.chdir(dir);
    await runAgent({
      config,
      registry,
      agent: scribe,
      prompt:
        "Read source.md and DESIGN a bespoke, presentation-quality HTML report from it, saved as report.html. " +
        "Make it polished: a cover title, a color system, a styled table, and bar charts for the scores. Ground every number in the source.",
      modelOverride: model,
      permissionMode: "full-auto",
      stream: false,
    });
  } finally {
    process.chdir(repoRoot);
  }
  const html = existsSync(join(dir, "report.html")) ? readFileSync(join(dir, "report.html"), "utf8") : "";
  const s = scoreDesign(html);
  const fab = checkDesignFidelity([SOURCE], html).fabricated;
  process.stdout.write(`  file: ${html ? "report.html ✓" : "MISSING ✗"}\n`);
  process.stdout.write(`  design richness: ${s.score}/8  [${Object.entries(s).filter(([k, v]) => v === true).map(([k]) => k).join(" ")}]\n`);
  process.stdout.write(`  fidelity: ${fab.length === 0 ? "✓ no fabricated numbers" : `✗ fabricated ${fab.join(",")}`}\n`);
  process.stdout.write(`  → ${html && s.score >= 5 && fab.length === 0 ? "PASS (polished + grounded)" : "review"}\n`);
  rmSync(dir, { recursive: true, force: true });
}
process.exit(0);

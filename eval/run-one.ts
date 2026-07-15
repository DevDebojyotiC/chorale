/**
 * Run a single ladder challenge on one model with FULL streaming so the whole
 * model log (output + tool calls + verify steps) is visible live.
 * Usage: pnpm exec tsx eval/run-one.ts "<provider:model>" [level]
 */
import "dotenv/config";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";

const modelRef = process.argv[2];
if (!modelRef) {
  console.error('usage: run-one.ts "<provider:model>"');
  process.exit(1);
}

const PROMPT =
  "Create a single file named solution.mjs in the current directory. It must use ESM syntax and " +
  "`export` the required symbol. Write ONLY that file, complete and correct. Export a function " +
  "`toRoman(n)` that converts an integer 1..3999 to its Roman-numeral string.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function grade(mod: any): void {
  const f = mod.toRoman ?? mod.default;
  const cases: Array<[number, string]> = [[4, "IV"], [58, "LVIII"], [1994, "MCMXCIV"], [3999, "MMMCMXCIX"]];
  for (const [n, exp] of cases) {
    const got = f(n);
    if (got !== exp) throw new Error(`toRoman(${n}) = ${got}, expected ${exp}`);
  }
}

const repoRoot = process.cwd();
const config = loadConfig();
const registry = buildRegistry(config);
const coder = loadAgent(resolve(repoRoot, "agents/coder.md"));
const ws = mkdtempSync(join(tmpdir(), "chorale-one-"));

process.stdout.write(`\n========== L1 Roman numerals · ${modelRef} ==========\n`);
process.stdout.write(`workspace: ${ws}\n`);
process.stdout.write(`--- live model log (output · [tool] calls · verify) ---\n\n`);

const t0 = Date.now();
try {
  process.chdir(ws);
  const res = await runAgent({
    config,
    registry,
    agent: coder,
    prompt: PROMPT,
    modelOverride: modelRef,
    permissionMode: "full-auto",
    stream: true,
  });
  process.chdir(repoRoot);
  const secs = Math.round((Date.now() - t0) / 1000);

  let verdict = "NO FILE WRITTEN";
  const file =
    (existsSync(join(ws, "solution.mjs")) && join(ws, "solution.mjs")) ||
    (readdirSync(ws).map((f) => join(ws, f)).find((f) => f.endsWith(".mjs") || f.endsWith(".js")) ?? null);
  if (file) {
    try {
      const mod = await import(pathToFileURL(file).href);
      grade(mod);
      verdict = "✅ PASS";
    } catch (e) {
      verdict = `❌ FAIL: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  process.stdout.write(`\n\n========== RESULT: ${verdict}  (model=${res.model}, ${secs}s) ==========\n`);
} finally {
  try {
    rmSync(ws, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
process.exit(0);

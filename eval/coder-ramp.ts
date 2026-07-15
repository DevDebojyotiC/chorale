/**
 * Open-ended difficulty ramp for ONE model. Escalates L1..LN until the model
 * fails, errors, times out, or exceeds the live-coding speed threshold. Streams
 * the full model log so progress is visible.
 *
 * Usage: pnpm exec tsx eval/coder-ramp.ts ["<provider:model>"]   (default: ollama:qwen2.5-coder:3b)
 */
import "dotenv/config";
process.env.CHORALE_NO_LEARN = "1"; // reproducible benchmarks: no self-learning
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { CHALLENGES, type Mod } from "./challenges.js";

const MODEL = process.argv[2] ?? "ollama:qwen2.5-coder:3b";
const HARD_TIMEOUT_MS = 360_000; // kill a single level after 6 min
const SLOW_THRESHOLD_S = 240; // > 4 min/level = not acceptable for live coding

function findSolution(ws: string): string | null {
  if (existsSync(join(ws, "solution.mjs"))) return join(ws, "solution.mjs");
  const f = (readdirSync(ws, { recursive: true }) as string[]).find((x) => String(x).endsWith(".mjs") || String(x).endsWith(".js"));
  return f ? join(ws, String(f)) : null;
}
function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | "TIMEOUT"> {
  return Promise.race([p, new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), ms))]);
}

const repoRoot = process.cwd();
const config = loadConfig();
const registry = buildRegistry(config);
const coder = loadAgent(resolve(repoRoot, "agents/coder.md"));

process.stdout.write(`\n########## RAMP: ${MODEL} ##########\n`);
process.stdout.write(`(stop on: fail · error · timeout · > ${SLOW_THRESHOLD_S}s per level)\n`);

let highestPassed = 0;
let stopReason = "completed all defined levels";
for (const ch of CHALLENGES) {
  process.stdout.write(`\n\n==================== L${ch.level}: ${ch.name} ====================\n\n`);
  const ws = mkdtempSync(join(tmpdir(), "chorale-ramp-"));
  const t0 = Date.now();
  let verdict = "";
  try {
    process.chdir(ws);
    const res = await raceTimeout(
      runAgent({ config, registry, agent: coder, prompt: ch.prompt, modelOverride: MODEL, permissionMode: "full-auto", stream: true }),
      HARD_TIMEOUT_MS,
    );
    process.chdir(repoRoot);
    const secs = Math.round((Date.now() - t0) / 1000);
    if (res === "TIMEOUT") { verdict = `TIMEOUT (>${HARD_TIMEOUT_MS / 1000}s)`; stopReason = `L${ch.level} timed out`; }
    else {
      const file = findSolution(ws);
      if (!file) { verdict = `NO FILE (${secs}s)`; stopReason = `L${ch.level} wrote no file`; }
      else {
        try {
          const mod = (await import(pathToFileURL(file).href)) as Mod;
          ch.test(mod);
          highestPassed = ch.level;
          verdict = `✅ PASS (${secs}s)`;
          if (secs > SLOW_THRESHOLD_S) { process.stdout.write(`\n→ ${verdict} — but ${secs}s exceeds the ${SLOW_THRESHOLD_S}s live-coding threshold.\n`); stopReason = `L${ch.level} passed but too slow for live coding (${secs}s)`; process.stdout.write(`\n########## STOP: ${stopReason} ##########\n`); break; }
        } catch (e) { verdict = `❌ FAIL: ${e instanceof Error ? e.message : String(e)} (${secs}s)`; stopReason = `L${ch.level} failed the tests`; }
      }
    }
  } catch (e) {
    process.chdir(repoRoot);
    verdict = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    stopReason = `L${ch.level} errored`;
  } finally {
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  process.stdout.write(`\n→ L${ch.level} ${verdict}\n`);
  if (!verdict.startsWith("✅")) { process.stdout.write(`\n########## STOP: ${stopReason} ##########\n`); break; }
}

process.stdout.write(`\n\n########## RAMP DONE — highest level passed: L${highestPassed} (${stopReason}) ##########\n`);
process.exit(0);

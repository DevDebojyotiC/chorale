/**
 * Head-to-head coder bake-off. Runs each model through the same L1..MAX challenges
 * (all levels, no early stop) and reports a pass grid + tokens + wall-time, so the
 * comparison is real numbers — not lifetime billing-dashboard artifacts.
 *
 * Usage: npx tsx eval/coder-bakeoff.ts [maxLevel] ["model1" "model2" ...]
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

const argv = process.argv.slice(2);
const MAX_LEVEL = argv[0] && /^\d+$/.test(argv[0]) ? Number(argv.shift()) : 6;
const MODELS = argv.length > 0 ? argv : [
  "hf:Qwen/Qwen2.5-7B-Instruct",
  "hf:google/gemma-4-31B-it",
  "hf:google/gemma-4-26B-A4B-it",
];
const HARD_TIMEOUT_MS = 240_000;

interface Cell { pass: boolean; secs: number; inTok: number; outTok: number; note: string }
interface Row { model: string; cells: Map<number, Cell>; passes: number; inTok: number; outTok: number; secs: number; error?: string }

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
const levels = CHALLENGES.filter((c) => c.level <= MAX_LEVEL);

process.stdout.write(`\n########## CODER BAKE-OFF · L1–L${MAX_LEVEL} ##########\n`);
process.stdout.write(`Models: ${MODELS.join(", ")}\n`);

const rows: Row[] = [];
for (const model of MODELS) {
  process.stdout.write(`\n===== ${model} =====\n`);
  const row: Row = { model, cells: new Map(), passes: 0, inTok: 0, outTok: 0, secs: 0 };
  for (const ch of levels) {
    const ws = mkdtempSync(join(tmpdir(), "chorale-bake-"));
    const t0 = Date.now();
    const cell: Cell = { pass: false, secs: 0, inTok: 0, outTok: 0, note: "" };
    try {
      process.chdir(ws);
      const res = await raceTimeout(
        runAgent({ config, registry, agent: coder, prompt: ch.prompt, modelOverride: model, permissionMode: "full-auto", stream: false }),
        HARD_TIMEOUT_MS,
      );
      process.chdir(repoRoot);
      cell.secs = Math.round((Date.now() - t0) / 1000);
      if (res === "TIMEOUT") {
        cell.note = "timeout";
      } else {
        cell.inTok = res.usage?.inputTokens ?? 0;
        cell.outTok = res.usage?.outputTokens ?? 0;
        const file = findSolution(ws);
        if (!file) cell.note = "no-file";
        else {
          try {
            const mod = (await import(pathToFileURL(file).href)) as Mod;
            ch.test(mod);
            cell.pass = true;
          } catch (e) {
            cell.note = e instanceof Error ? e.message.slice(0, 40) : String(e).slice(0, 40);
          }
        }
      }
    } catch (e) {
      process.chdir(repoRoot);
      cell.secs = Math.round((Date.now() - t0) / 1000);
      const msg = e instanceof Error ? e.message : String(e);
      cell.note = msg.slice(0, 60);
      // A model that can't even be served (bad id / provider down) — record and skip rest.
      if (/fetch failed|not found|404|Unauthorized|401|does not exist|unsupported/i.test(msg) && row.cells.size === 0) {
        row.error = msg.slice(0, 120);
        process.stdout.write(`  L${ch.level} ✗ ERROR (${cell.note})\n`);
        rmSync(ws, { recursive: true, force: true });
        break;
      }
    } finally {
      try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    row.cells.set(ch.level, cell);
    row.secs += cell.secs;
    row.inTok += cell.inTok;
    row.outTok += cell.outTok;
    if (cell.pass) row.passes++;
    process.stdout.write(
      `  L${ch.level} ${cell.pass ? "✅" : "❌"} ${String(cell.secs).padStart(3)}s  in=${String(cell.inTok).padStart(5)} out=${String(cell.outTok).padStart(5)}${cell.note ? `  (${cell.note})` : ""}\n`,
    );
  }
  rows.push(row);
}

// ---- Summary table ----
process.stdout.write(`\n\n########## RESULTS (L1–L${MAX_LEVEL}) ##########\n\n`);
const head = ["model".padEnd(34), ...levels.map((c) => `L${c.level}`), "pass", "in tok", "out tok", "sec"];
process.stdout.write(head.join("  ") + "\n");
for (const r of rows) {
  const grid = levels.map((c) => (r.cells.get(c.level)?.pass ? " ✅" : r.cells.has(c.level) ? " ❌" : "  ·"));
  process.stdout.write(
    [
      r.model.padEnd(34),
      ...grid,
      `${r.passes}/${levels.length}`.padStart(4),
      String(r.inTok).padStart(6),
      String(r.outTok).padStart(7),
      String(r.secs).padStart(3),
    ].join("  ") + (r.error ? `   ⚠ ${r.error}` : "") + "\n",
  );
}
process.stdout.write(
  `\nNote: cost ∝ output tokens × the provider's per-token price (bigger model ⇒ higher price).\n` +
    `Compare 'out tok' across models, then confirm dollars against the HF billing delta.\n`,
);
process.exit(0);

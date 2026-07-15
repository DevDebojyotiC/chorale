/**
 * Real-engineering benchmark. Unlike the single-file ramp, each project is a
 * multi-file / multi-step task graded with PARTIAL CREDIT by running the result:
 *   1. build   — a KV-store library (TTL + LRU) across src/store.mjs + src/index.mjs
 *   2. debug   — fix planted bugs in a broken multi-file lib until its tests pass
 *   3. async   — a bounded-concurrency promise pool with order + error semantics
 *   4. cli     — a stateful todo CLI persisting to JSON across processes
 * The coder runs with its full toolset (incl. bash, so it can run tests and iterate).
 *
 * Usage: pnpm exec tsx eval/coder-projects.ts ["model1" "model2" ...]
 */
import "dotenv/config";
import { mkdtempSync, rmSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";

const MODELS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["hf:google/gemma-4-31B-it", "fireworks:accounts/fireworks/models/gpt-oss-120b", "fireworks:accounts/fireworks/models/minimax-m2p7"];

// Normalized rates ($/M): [cached input, output]. null = not on these cards (HF ≈ $0).
const RATES: Record<string, [number, number] | null> = {
  "hf:google/gemma-4-31B-it": null,
  "fireworks:accounts/fireworks/models/gpt-oss-120b": [0.01, 0.6],
  "fireworks:accounts/fireworks/models/minimax-m2p7": [0.06, 1.2],
};

const HARD_TIMEOUT_MS = 300_000;
const a = (cond: boolean, msg?: string): void => { if (!cond) throw new Error(msg ?? "assert failed"); };
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
type Check = [string, () => void | Promise<void>];
interface Grade { passed: number; total: number; fails: string[] }

async function scoreChecks(checks: Check[]): Promise<Grade> {
  let passed = 0;
  const fails: string[] = [];
  for (const [name, fn] of checks) {
    try { await fn(); passed += 1; } catch (e) { fails.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { passed, total: checks.length, fails };
}

const repoRoot = process.cwd();
const seedDebug = resolve(repoRoot, "eval/projects/debug-lib");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mod = Record<string, any>;
const tryImport = async (p: string): Promise<Mod | null> => {
  try { return existsSync(p) ? ((await import(pathToFileURL(p).href)) as Mod) : null; } catch { return null; }
};

interface Project {
  id: string;
  title: string;
  skill: string;
  maxSteps: number;
  setup?: (dir: string) => void;
  prompt: string;
  grade: (dir: string) => Promise<Grade>;
}

const PROJECTS: Project[] = [
  {
    id: "kvstore", title: "KV store — TTL + LRU (build, multi-file)", skill: "build", maxSteps: 14,
    prompt:
      "Build a key-value store library using only Node built-ins (ESM). Create exactly two files:\n" +
      "• src/store.mjs — export a class `KVStore`. Constructor takes an options object `{ capacity, now }`: " +
      "`capacity` is the max number of live entries (default Infinity); `now` is a function returning the current time in ms (default Date.now). " +
      "Methods: set(key, value, opts) where opts.ttlMs (optional) makes the entry expire at now()+ttlMs; get(key) returns the value or undefined if missing/expired and counts as a use for LRU; " +
      "has(key) boolean respecting expiry; delete(key) returns boolean; size() the count of live (non-expired) entries; keys() an array of live keys ordered most-recently-used LAST. " +
      "On set, if adding a NEW key would exceed capacity, first evict the least-recently-used live entry.\n" +
      "• src/index.mjs — re-export { KVStore }.\n" +
      "Use the injected `now` for all time checks so it is testable. No external packages.",
    grade: async (dir) => {
      const m = await tryImport(join(dir, "src/index.mjs"));
      const KV = (m?.KVStore ?? m?.default) as (new (o?: unknown) => Mod) | undefined;
      let t = 0;
      const now = (): number => t;
      const K = (o: Record<string, unknown> = {}): Mod => new (KV as new (o: unknown) => Mod)({ now, ...o });
      return scoreChecks([
        ["set/get", () => { const s = K(); s.set("a", 1); a(s.get("a") === 1, "get a"); }],
        ["missing → undefined", () => { const s = K(); a(s.get("x") === undefined && s.has("x") === false, "x absent"); }],
        ["ttl live before expiry", () => { t = 0; const s = K(); s.set("b", 2, { ttlMs: 100 }); t = 50; a(s.get("b") === 2, "b live"); }],
        ["ttl expired", () => { t = 0; const s = K(); s.set("b", 2, { ttlMs: 100 }); t = 150; a(s.get("b") === undefined && s.has("b") === false, "b expired"); }],
        ["size counts live only", () => { t = 0; const s = K(); s.set("a", 1); s.set("b", 2, { ttlMs: 10 }); t = 50; a(s.size() === 1, "size=" + s.size()); }],
        ["delete", () => { const s = K(); s.set("a", 1); a(s.delete("a") === true && s.delete("a") === false && s.get("a") === undefined, "delete"); }],
        ["LRU eviction", () => { t = 0; const s = K({ capacity: 2 }); s.set("a", 1); s.set("b", 2); s.get("a"); s.set("c", 3); a(s.has("a") && !s.has("b") && s.has("c"), "evict lru b"); }],
        ["keys() MRU last", () => { const s = K(); s.set("a", 1); s.set("b", 2); s.get("a"); const k = s.keys(); a(k[k.length - 1] === "a", "a last: " + JSON.stringify(k)); }],
      ]);
    },
  },
  {
    id: "debug", title: "Fix a broken multi-file library (debug)", skill: "debug", maxSteps: 16,
    setup: (dir) => cpSync(seedDebug, dir, { recursive: true }),
    prompt:
      "This project's test suite fails. Run `node test.mjs` to see the failures, then FIX THE BUGS in the source files under lib/ " +
      "(range.mjs, clamp.mjs, emitter.mjs) so that every check passes. Do NOT modify test.mjs. Keep the public API identical. " +
      "Re-run the tests until they all pass.",
    grade: async (dir) => {
      // Restore the canonical test so edits to it cannot game the score.
      cpSync(join(seedDebug, "test.mjs"), join(dir, "test.mjs"));
      let out = "";
      try { out = execFileSync("node", ["test.mjs"], { cwd: dir, encoding: "utf8", timeout: 20_000 }); }
      catch (e) { const x = e as { stdout?: string; stderr?: string }; out = (x.stdout ?? "") + "\n" + (x.stderr ?? ""); }
      const m = out.match(/PASS\s+(\d+)\/(\d+)/);
      if (!m) return { passed: 0, total: 7, fails: ["no PASS line; tail:\n" + out.slice(-300)] };
      return { passed: Number(m[1]), total: Number(m[2]), fails: out.split("\n").filter((l) => l.startsWith("FAIL")) };
    },
  },
  {
    id: "asyncpool", title: "Bounded-concurrency promise pool (async)", skill: "async", maxSteps: 12,
    prompt:
      "Create pool.mjs (ESM, Node built-ins only) exporting `async function runPool(tasks, concurrency)`. " +
      "`tasks` is an array of zero-arg functions each returning a Promise. Run them with AT MOST `concurrency` in flight at once. " +
      "Resolve to an array of results in the SAME ORDER as `tasks` (input order, not completion order). Never exceed `concurrency` simultaneously, " +
      "and do use the full budget when there is work. If a task rejects, wait for all already-started tasks to settle, then reject with the first error (by task index).",
    grade: async (dir) => {
      const m = await tryImport(join(dir, "pool.mjs"));
      const runPool = (m?.runPool ?? m?.default) as ((t: Array<() => Promise<unknown>>, c: number) => Promise<unknown[]>) | undefined;
      const rp = (t: Array<() => Promise<unknown>>, c: number): Promise<unknown[]> => {
        if (typeof runPool !== "function") throw new Error("no runPool export");
        return runPool(t, c);
      };
      return scoreChecks([
        ["result order preserved", async () => {
          const r = await rp([() => delay(30).then(() => "a"), () => delay(5).then(() => "b"), () => delay(15).then(() => "c")], 2);
          a(JSON.stringify(r) === JSON.stringify(["a", "b", "c"]), "order " + JSON.stringify(r));
        }],
        ["respects the concurrency bound", async () => {
          let cur = 0, max = 0;
          const mk = (i: number) => () => { cur += 1; max = Math.max(max, cur); return delay(20).then(() => { cur -= 1; return i; }); };
          const r = await rp([0, 1, 2, 3, 4, 5].map(mk), 2);
          a(max <= 2, "max concurrent " + max);
          a(JSON.stringify(r) === JSON.stringify([0, 1, 2, 3, 4, 5]), "order " + JSON.stringify(r));
        }],
        ["actually parallel (uses the budget)", async () => {
          let cur = 0, max = 0;
          const mk = (i: number) => () => { cur += 1; max = Math.max(max, cur); return delay(20).then(() => { cur -= 1; return i; }); };
          await rp([0, 1, 2, 3].map(mk), 3);
          a(max === 3, "expected peak 3, got " + max);
        }],
        ["rejects on task error", async () => {
          let rejected = false;
          try { await rp([() => delay(5).then(() => 1), () => delay(5).then(() => { throw new Error("boom"); }), () => delay(5).then(() => 3)], 2); }
          catch (e) { rejected = true; a(String((e as Error).message ?? e).includes("boom"), "err " + e); }
          a(rejected, "should reject");
        }],
        ["settles in-flight before rejecting", async () => {
          let settled = 0;
          const mk = (i: number, fail: boolean) => () => delay(10).then(() => { settled += 1; if (fail) throw new Error("x" + i); return i; });
          try { await rp([mk(0, false), mk(1, true), mk(2, false)], 3); } catch { /* expected */ }
          await delay(50);
          a(settled === 3, "all settled, got " + settled);
        }],
      ]);
    },
  },
  {
    id: "cli", title: "Stateful todo CLI with JSON persistence (cli)", skill: "cli", maxSteps: 12,
    prompt:
      "Create todo.mjs (ESM, Node built-ins) — a CLI that persists to todos.json in the current working directory:\n" +
      "• `node todo.mjs add <text>` → adds a todo, prints `added #<id>: <text>` (id is a stable integer starting at 1, incrementing).\n" +
      "• `node todo.mjs list` → prints each todo on its own line as `<id> [ ] <text>` (open) or `<id> [x] <text>` (done), in ascending id order.\n" +
      "• `node todo.mjs done <id>` → marks it done, prints `done #<id>`.\n" +
      "• `node todo.mjs rm <id>` → removes it, prints `removed #<id>`.\n" +
      "State MUST persist across separate invocations via todos.json (create it if missing). Handle the first run with no file.",
    grade: async (dir) => {
      // Clean slate: the model may have created todos.json while testing its own CLI.
      try { rmSync(join(dir, "todos.json"), { force: true }); } catch { /* ignore */ }
      const run = (...args: string[]): string => {
        try { return execFileSync("node", ["todo.mjs", ...args], { cwd: dir, encoding: "utf8", timeout: 15_000 }); }
        catch (e) { const x = e as { stdout?: string; stderr?: string }; return (x.stdout ?? "") + (x.stderr ?? ""); }
      };
      return scoreChecks([
        ["add #1", () => { a(/added #1/i.test(run("add", "buy milk")), "add1"); }],
        ["add #2", () => { a(/added #2/i.test(run("add", "walk dog")), "add2"); }],
        ["done #1", () => { a(/done #1/i.test(run("done", "1")), "done1"); }],
        ["list reflects state", () => { const o = run("list"); a(/1\s*\[x\]\s*buy milk/i.test(o) && /2\s*\[ \]\s*walk dog/i.test(o), "list: " + JSON.stringify(o)); }],
        ["rm #2", () => { a(/removed #2/i.test(run("rm", "2")), "rm2"); }],
        ["persists across processes", () => { const o = run("list"); a(/buy milk/.test(o) && !/walk dog/.test(o), "persist: " + JSON.stringify(o)); }],
      ]);
    },
  },
];

function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | "TIMEOUT"> {
  return Promise.race([p, new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), ms))]);
}

export { PROJECTS };
export type { Project, Grade };

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (!isMain) {
  // Imported (e.g. by the grader self-test) — don't run the benchmark.
} else {
const config = loadConfig();
const registry = buildRegistry(config);
const coder = loadAgent(resolve(repoRoot, "agents/coder.md"));

process.stdout.write(`\n########## REAL-ENGINEERING BENCHMARK ##########\n`);
process.stdout.write(`Projects: ${PROJECTS.map((p) => p.id).join(", ")}\nModels: ${MODELS.join(", ")}\n`);

interface Row { model: string; cells: Record<string, Grade>; inTok: number; outTok: number; secs: number }
const rows: Row[] = [];

for (const model of MODELS) {
  process.stdout.write(`\n===== ${model.replace(/.*\//, "")} =====\n`);
  const row: Row = { model, cells: {}, inTok: 0, outTok: 0, secs: 0 };
  for (const proj of PROJECTS) {
    const ws = mkdtempSync(join(tmpdir(), `chorale-proj-${proj.id}-`));
    if (proj.setup) proj.setup(ws);
    const t0 = Date.now();
    let grade: Grade = { passed: 0, total: 1, fails: ["did not run"] };
    try {
      process.chdir(ws);
      const res = await raceTimeout(
        runAgent({ config, registry, agent: coder, prompt: proj.prompt, modelOverride: model, permissionMode: "full-auto", stream: false, maxSteps: proj.maxSteps }),
        HARD_TIMEOUT_MS,
      );
      process.chdir(repoRoot);
      if (res !== "TIMEOUT") { row.inTok += res.usage?.inputTokens ?? 0; row.outTok += res.usage?.outputTokens ?? 0; }
      grade = res === "TIMEOUT" ? { passed: 0, total: 1, fails: ["TIMEOUT"] } : await proj.grade(ws);
    } catch (e) {
      process.chdir(repoRoot);
      grade = { passed: 0, total: 1, fails: ["harness error: " + (e instanceof Error ? e.message : String(e))] };
    } finally {
      try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    row.secs += secs;
    row.cells[proj.id] = grade;
    const pct = Math.round((grade.passed / grade.total) * 100);
    process.stdout.write(`  ${proj.id.padEnd(9)} ${grade.passed}/${grade.total}  (${pct}%, ${secs}s)${grade.fails.length ? "  ✗ " + grade.fails.slice(0, 3).join(" | ").slice(0, 160) : ""}\n`);
  }
  rows.push(row);
}

// ---- Summary ----
process.stdout.write(`\n\n########## RESULTS ##########\n\n`);
const head = ["model".padEnd(14), ...PROJECTS.map((p) => p.id.padEnd(9)), "overall", "in tok", "out tok", "sec", "cost$"];
process.stdout.write(head.join("  ") + "\n");
for (const r of rows) {
  let sp = 0, st = 0;
  const cells = PROJECTS.map((p) => { const g = r.cells[p.id]!; sp += g.passed; st += g.total; return `${g.passed}/${g.total}`.padEnd(9); });
  const rate = RATES[r.model];
  const cost = rate ? (r.inTok * rate[0] + r.outTok * rate[1]) / 1e6 : 0;
  process.stdout.write([
    r.model.replace(/.*\//, "").slice(0, 14).padEnd(14),
    ...cells,
    `${Math.round((sp / st) * 100)}%`.padStart(7),
    String(r.inTok).padStart(6),
    String(r.outTok).padStart(7),
    String(r.secs).padStart(3),
    rate ? ("$" + cost.toFixed(4)).padStart(7) : "≈$0.00".padStart(7),
  ].join("  ") + "\n");
}
process.stdout.write(`\nPartial credit per project; overall = total checks passed / total checks. Cost normalized (cached-in + output).\n`);
process.exit(0);
}

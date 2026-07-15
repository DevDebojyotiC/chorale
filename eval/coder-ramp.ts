/**
 * Open-ended difficulty ramp for ONE model. Escalates L1..LN until the model
 * fails, errors, times out, or exceeds the live-coding speed threshold. Streams
 * the full model log so progress is visible.
 *
 * Usage: pnpm exec tsx eval/coder-ramp.ts ["<provider:model>"]   (default: ollama:qwen2.5-coder:3b)
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

const MODEL = process.argv[2] ?? "ollama:qwen2.5-coder:3b";
const HARD_TIMEOUT_MS = 360_000; // kill a single level after 6 min
const SLOW_THRESHOLD_S = 240; // > 4 min/level = not acceptable for live coding

function eq<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
/**
 * Resolve the export under test. Prefer the exact requested name, then `default`,
 * then the sole callable (function/class) export — so a cosmetic name mismatch
 * (e.g. `intToRoman` vs `toRoman`) doesn't mask otherwise-correct logic. This
 * ramp measures algorithmic capability, not exact-identifier instruction-following.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(m: Mod, name: string): any {
  if (typeof m[name] === "function") return m[name];
  if (typeof m.default === "function") return m.default;
  const fns = Object.values(m).filter((v) => typeof v === "function");
  if (fns.length === 1) return fns[0];
  const ci = Object.entries(m).find(([k, v]) => typeof v === "function" && k.toLowerCase() === name.toLowerCase());
  return ci?.[1] ?? m[name] ?? m.default;
}
const P = (spec: string) =>
  `Create a single file named solution.mjs in the current directory. It must use ESM syntax and ` +
  `\`export\` the required symbol. Write ONLY that file, complete and correct. ${spec}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mod = Record<string, any>;
interface Challenge {
  level: number;
  name: string;
  prompt: string;
  test: (m: Mod) => void;
}

const CHALLENGES: Challenge[] = [
  { level: 1, name: "Roman numerals", prompt: P("Export `toRoman(n)` converting 1..3999 to a Roman-numeral string."),
    test: (m) => { const f = pick(m, "toRoman"); assert(f(4) === "IV" && f(58) === "LVIII" && f(1994) === "MCMXCIV" && f(3999) === "MMMCMXCIX", "roman"); } },
  { level: 2, name: "Balanced brackets", prompt: P("Export `isBalanced(s)` returning true iff ()[]{} are balanced and nested."),
    test: (m) => { const f = pick(m, "isBalanced"); assert(f("()[]{}") && f("([{}])") && !f("(]") && !f("([)]") && f(""), "brackets"); } },
  { level: 3, name: "Expression evaluator", prompt: P("Export `evaluate(str)` for + - * / and parentheses with precedence; returns a number."),
    test: (m) => { const f = pick(m, "evaluate"); assert(f("2+3*4") === 14 && f("(2+3)*4") === 20 && f("10/4") === 2.5 && f("2*(3+(4-1))") === 12, "expr"); } },
  { level: 4, name: "LRU cache", prompt: P("Export class `LRUCache` with constructor(capacity), get(key)->value|-1, put(key,value); evict least-recently-used."),
    test: (m) => { const C = pick(m, "LRUCache"); const c = new C(2); c.put(1, 1); c.put(2, 2); assert(c.get(1) === 1, "g1"); c.put(3, 3); assert(c.get(2) === -1, "e2"); c.put(4, 4); assert(c.get(1) === -1 && c.get(3) === 3 && c.get(4) === 4, "lru"); } },
  { level: 5, name: "JSON parser", prompt: P("Export `parseJSON(str)` parsing JSON WITHOUT JSON.parse: objects, arrays, strings (escapes), numbers, booleans, null, whitespace."),
    test: (m) => { const f = pick(m, "parseJSON"); assert(eq(f('{"a":1,"b":[true,null,"x"]}'), { a: 1, b: [true, null, "x"] }), "j1"); assert(eq(f('{"c":{"d":-2.5,"e":"a\\"b"}}'), { c: { d: -2.5, e: 'a"b' } }), "j2"); assert(eq(f('"hi\\nthere"'), "hi\nthere"), "j3"); } },
  { level: 6, name: "Regex matcher (. and *)", prompt: P("Export `isMatch(s, p)`: regex match where '.' matches any single char and '*' matches zero-or-more of the preceding element. Full-string match."),
    test: (m) => { const f = pick(m, "isMatch"); assert(f("aa", "a") === false && f("aa", "a*") === true && f("ab", ".*") === true && f("aab", "c*a*b") === true && f("mississippi", "mis*is*p*.") === false, "regex"); } },
  { level: 7, name: "Topological order", prompt: P("Export `findOrder(n, prerequisites)`: prerequisites[i]=[a,b] means take b before a. Return a valid ordering of 0..n-1, or [] if impossible (cycle)."),
    test: (m) => {
      const f = pick(m, "findOrder");
      const ok = (n: number, pre: number[][]) => { const o = f(n, pre); if (!Array.isArray(o) || o.length !== n) return false; const pos = new Map(o.map((c: number, i: number) => [c, i])); return pre.every(([a, b]) => pos.has(a) && pos.has(b) && (pos.get(b) as number) < (pos.get(a) as number)); };
      assert(ok(2, [[1, 0]]), "t1");
      const cyc = f(2, [[1, 0], [0, 1]]); assert(Array.isArray(cyc) && cyc.length === 0, "cycle");
      assert(ok(4, [[1, 0], [2, 0], [3, 1], [3, 2]]), "t3");
    } },
  { level: 8, name: "CSV parser", prompt: P("Export `parseCSV(text)` returning an array of rows (arrays of string fields). Support double-quoted fields that may contain commas and newlines; a doubled quote inside a quoted field is a literal quote character."),
    test: (m) => { const f = pick(m, "parseCSV"); assert(eq(f("a,b,c"), [["a", "b", "c"]]), "c1"); assert(eq(f('a,"b,c",d'), [["a", "b,c", "d"]]), "c2"); assert(eq(f('"he said ""hi"""'), [['he said "hi"']]), "c3"); assert(eq(f("a,b\nc,d"), [["a", "b"], ["c", "d"]]), "c4"); } },
  { level: 9, name: "Mini interpreter", prompt: P("Export `run(program)`: statements separated by ';'. Supports variable assignment `name = expr` and arithmetic (+ - * / and parens, variables). Return the value of the final expression."),
    test: (m) => { const f = pick(m, "run"); assert(f("x = 3; y = x * 2; y + 1") === 7, "i1"); assert(f("a = 10; b = a / 2; a + b") === 15, "i2"); assert(f("2 + 3 * 4") === 14, "i3"); } },
  { level: 10, name: "Dijkstra shortest path", prompt: P("Export `shortestPath(edges, n, start, end)`: edges are directed [u,v,w]. Return the minimum total weight from start to end, or -1 if unreachable."),
    test: (m) => { const f = pick(m, "shortestPath"); assert(f([[0, 1, 4], [0, 2, 1], [2, 1, 2], [1, 3, 1], [2, 3, 5]], 4, 0, 3) === 4, "d1"); assert(f([[0, 1, 1]], 2, 1, 0) === -1, "d2"); assert(f([[0, 1, 2], [1, 2, 3]], 3, 0, 2) === 5, "d3"); } },
];

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

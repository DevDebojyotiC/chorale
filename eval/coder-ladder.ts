/**
 * Chorale-Coder difficulty ladder.
 *
 * Escalates through 5 algorithm challenges of increasing difficulty. For each level,
 * every model writes `solution.mjs`; a HIDDEN test suite grades correctness (logic,
 * not just syntax). Stops after 5 levels or early if a level breaks the whole field.
 *
 * Usage: npx tsx eval/coder-ladder.ts   (needs HF_TOKEN / FIREWORKS_API_KEY)
 */
import "dotenv/config";
process.env.CHORALE_NO_REVIEW_GATE = "1"; // benchmarks measure the coder alone, not the review gate
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";

const TIMEOUT_MS = 200_000;

const MODELS = [
  { label: "qwen3:4b (local)", ref: "ollama:qwen3:4b" },
  { label: "Qwen2.5-7B", ref: "hf:Qwen/Qwen2.5-7B-Instruct" },
  { label: "gpt-oss-120B", ref: "fireworks:accounts/fireworks/models/gpt-oss-120b" },
  { label: "GLM-5.2", ref: "fireworks:accounts/fireworks/models/glm-5p2" },
  { label: "Kimi-K2", ref: "fireworks:accounts/fireworks/models/kimi-k2p6" },
];

function eq<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

interface Challenge {
  level: number;
  name: string;
  prompt: string;
  test: (mod: Record<string, unknown>) => void;
}

const P = (spec: string) =>
  `Create a single file named solution.mjs in the current directory. It must use ESM syntax and ` +
  `\`export\` the required symbol. Write ONLY that file, complete and correct. ${spec}`;

const CHALLENGES: Challenge[] = [
  {
    level: 1,
    name: "Roman numerals",
    prompt: P("Export a function `toRoman(n)` that converts an integer 1..3999 to its Roman-numeral string."),
    test: (m) => {
      const f = (m.toRoman ?? m.default) as (n: number) => string;
      assert(f(4) === "IV", "4");
      assert(f(58) === "LVIII", "58");
      assert(f(1994) === "MCMXCIV", "1994");
      assert(f(3999) === "MMMCMXCIX", "3999");
    },
  },
  {
    level: 2,
    name: "Balanced brackets",
    prompt: P("Export a function `isBalanced(s)` returning true iff the brackets ()[]{} in the string are correctly balanced and nested."),
    test: (m) => {
      const f = (m.isBalanced ?? m.default) as (s: string) => boolean;
      assert(f("()[]{}") === true, "a");
      assert(f("([{}])") === true, "b");
      assert(f("(]") === false, "c");
      assert(f("([)]") === false, "d");
      assert(f("") === true, "e");
    },
  },
  {
    level: 3,
    name: "Expression evaluator",
    prompt: P("Export a function `evaluate(str)` that evaluates an arithmetic expression with + - * / and parentheses, honoring precedence. Numbers may be integers or decimals. Return a number."),
    test: (m) => {
      const f = (m.evaluate ?? m.default) as (s: string) => number;
      assert(f("2+3*4") === 14, "a");
      assert(f("(2+3)*4") === 20, "b");
      assert(f("10/4") === 2.5, "c");
      assert(f("2*(3+(4-1))") === 12, "d");
      assert(f("1+2+3+4") === 10, "e");
    },
  },
  {
    level: 4,
    name: "LRU cache",
    prompt: P("Export a class `LRUCache` with `constructor(capacity)`, `get(key)` returning the value or -1, and `put(key, value)`. Least-recently-used entries are evicted when over capacity. get and put should be O(1)."),
    test: (m) => {
      const C = (m.LRUCache ?? m.default) as new (n: number) => { get(k: number): number; put(k: number, v: number): void };
      const c = new C(2);
      c.put(1, 1);
      c.put(2, 2);
      assert(c.get(1) === 1, "get1");
      c.put(3, 3); // evicts 2
      assert(c.get(2) === -1, "evict2");
      c.put(4, 4); // evicts 1
      assert(c.get(1) === -1, "evict1");
      assert(c.get(3) === 3, "get3");
      assert(c.get(4) === 4, "get4");
    },
  },
  {
    level: 5,
    name: "JSON parser (no JSON.parse)",
    prompt: P("Export a function `parseJSON(str)` that parses a JSON string into the equivalent JS value WITHOUT using the built-in JSON.parse. Support objects, arrays, strings (with escapes), numbers, booleans, null, and whitespace."),
    test: (m) => {
      const f = (m.parseJSON ?? m.default) as (s: string) => unknown;
      assert(eq(f('{"a":1,"b":[true,null,"x"]}'), { a: 1, b: [true, null, "x"] }), "a");
      assert(eq(f('{"c":{"d":-2.5,"e":"a\\"b"}}'), { c: { d: -2.5, e: 'a"b' } }), "b");
      assert(eq(f("  [1, 2, 3]  "), [1, 2, 3]), "c");
      assert(eq(f('"hello\\nworld"'), "hello\nworld"), "d");
    },
  },
];

function findSolution(ws: string): string | null {
  if (existsSync(join(ws, "solution.mjs"))) return join(ws, "solution.mjs");
  const files = readdirSync(ws, { recursive: true }) as string[];
  const mjs = files.find((f) => String(f).endsWith(".mjs"));
  if (mjs) return join(ws, String(mjs));
  const js = files.find((f) => String(f).endsWith(".js"));
  return js ? join(ws, String(js)) : null;
}

function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | "TIMEOUT"> {
  return Promise.race([p, new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), ms))]);
}

const repoRoot = process.cwd();
const config = loadConfig();
const registry = buildRegistry(config);
const coder = loadAgent(resolve(repoRoot, "agents/coder.md"));

type Cell = { pass: boolean; secs: number; note: string };
const grid: Record<string, Record<number, Cell>> = {};
for (const m of MODELS) grid[m.label] = {};

for (const ch of CHALLENGES) {
  process.stderr.write(`\n\n########## LEVEL ${ch.level}: ${ch.name} ##########\n`);
  let anyPass = false;
  for (const m of MODELS) {
    process.stderr.write(`\n----- L${ch.level} · ${m.label} -----\n`);
    const ws = mkdtempSync(join(tmpdir(), "chorale-ladder-"));
    const started = Date.now();
    const cell: Cell = { pass: false, secs: 0, note: "" };
    try {
      process.chdir(ws);
      const res = await raceTimeout(
        runAgent({ config, registry, agent: coder, prompt: ch.prompt, modelOverride: m.ref, permissionMode: "full-auto", stream: false }),
        TIMEOUT_MS,
      );
      process.chdir(repoRoot);
      if (res === "TIMEOUT") {
        cell.note = "timeout";
      } else {
        const file = findSolution(ws);
        if (!file) {
          cell.note = "no file";
        } else {
          try {
            const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
            ch.test(mod);
            cell.pass = true;
            cell.note = "PASS";
          } catch (e) {
            cell.note = `fail: ${e instanceof Error ? e.message : String(e)}`.slice(0, 40);
          }
        }
      }
    } catch (e) {
      process.chdir(repoRoot);
      cell.note = `err: ${e instanceof Error ? e.message : String(e)}`.slice(0, 40);
    } finally {
      try {
        rmSync(ws, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    cell.secs = Math.round((Date.now() - started) / 1000);
    grid[m.label]![ch.level] = cell;
    anyPass = anyPass || cell.pass;
    process.stderr.write(`  → ${cell.pass ? "PASS" : "FAIL"} (${cell.note}, ${cell.secs}s)\n`);
  }
  if (!anyPass) {
    process.stderr.write(`\n########## LEVEL ${ch.level} broke the entire field — stopping ##########\n`);
    break;
  }
}

// Final matrix
console.log("\n\n=== CHORALE-CODER DIFFICULTY LADDER ===\n");
const header = ["model".padEnd(17), ...CHALLENGES.map((c) => `L${c.level}`)].join(" | ");
console.log(header);
console.log("-".repeat(header.length));
for (const m of MODELS) {
  const cells = CHALLENGES.map((c) => {
    const cell = grid[m.label]![c.level];
    if (!cell) return "· ";
    return cell.pass ? "✓ " : cell.note === "timeout" ? "T " : "✗ ";
  });
  console.log([m.label.padEnd(17), ...cells].join(" | "));
}
console.log("\nLegend: ✓ pass · ✗ fail · T timeout · (blank) not reached");
console.log("Levels: L1 Roman · L2 Brackets · L3 Expr-eval · L4 LRU · L5 JSON-parser\n");
process.exit(0);

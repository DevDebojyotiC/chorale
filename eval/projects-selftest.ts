/**
 * Validates the real-engineering graders against KNOWN-GOOD and KNOWN-BAD
 * reference solutions, so a grader bug can't silently penalize the models.
 * Run: npx tsx eval/projects-selftest.ts
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PROJECTS } from "./coder-projects.js";

const ws = (): string => mkdtempSync(join(tmpdir(), "chorale-selftest-"));
const P = Object.fromEntries(PROJECTS.map((p) => [p.id, p]));
let ok = true;
const expect = (label: string, got: string, want: string): void => {
  const pass = got === want;
  if (!pass) ok = false;
  process.stdout.write(`  ${pass ? "✓" : "✗"} ${label}: ${got}${pass ? "" : ` (expected ${want})`}\n`);
};

// ---- KV store: reference implementation should score 8/8 ----
{
  const d = ws();
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src/store.mjs"), `
export class KVStore {
  constructor({ capacity = Infinity, now = Date.now } = {}) { this.cap = capacity; this.now = now; this.m = new Map(); }
  #live(k){ const e = this.m.get(k); if(!e) return undefined; if(e.exp!=null && this.now() >= e.exp){ this.m.delete(k); return undefined; } return e; }
  set(k,v,opts={}){ const exp = opts.ttlMs!=null ? this.now()+opts.ttlMs : null; if(!this.m.has(k) && this.size() >= this.cap){ this.#evict(); } this.m.delete(k); this.m.set(k,{v,exp}); return this; }
  get(k){ const e=this.#live(k); if(!e) return undefined; this.m.delete(k); this.m.set(k,e); return e.v; }
  has(k){ return this.#live(k)!==undefined; }
  delete(k){ return this.m.delete(k); }
  size(){ let n=0; for(const k of [...this.m.keys()]) if(this.#live(k)) n++; return n; }
  keys(){ return [...this.m.keys()].filter(k=>this.#live(k)); }
  #evict(){ for(const k of this.m.keys()){ if(this.#live(k)){ this.m.delete(k); return; } } }
}`);
  writeFileSync(join(d, "src/index.mjs"), `export { KVStore } from "./store.mjs";`);
  const g = await P.kvstore!.grade(d);
  expect("kvstore good", `${g.passed}/${g.total}`, "8/8");
  if (g.fails.length) process.stdout.write("    " + g.fails.join("\n    ") + "\n");
  rmSync(d, { recursive: true, force: true });
}

// ---- Debug: unfixed seed → 3/7 ; fixed → 7/7 ----
{
  const d = ws();
  cpSync(resolve("eval/projects/debug-lib"), d, { recursive: true });
  const bad = await P.debug!.grade(d);
  expect("debug (broken seed)", `${bad.passed}/${bad.total}`, "3/7");
  // apply the fixes
  writeFileSync(join(d, "lib/range.mjs"), readFileSync(join(d, "lib/range.mjs"), "utf8").replace("i <= end", "i < end"));
  writeFileSync(join(d, "lib/clamp.mjs"), readFileSync(join(d, "lib/clamp.mjs"), "utf8").replace("if (n > max) return min;", "if (n > max) return max;"));
  writeFileSync(join(d, "lib/emitter.mjs"), readFileSync(join(d, "lib/emitter.mjs"), "utf8").replace("if (arr) this.map.set(evt, []);", "if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); }"));
  const good = await P.debug!.grade(d);
  expect("debug (fixed)", `${good.passed}/${good.total}`, "7/7");
  rmSync(d, { recursive: true, force: true });
}

// ---- Async pool: reference → 5/5 ----
{
  const d = ws();
  writeFileSync(join(d, "pool.mjs"), `
export async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0, firstErr;
  async function worker(){ while(next < tasks.length){ const i = next++; try { results[i] = await tasks[i](); } catch(e){ if(firstErr===undefined) firstErr = e; } } }
  const n = Math.max(1, Math.min(concurrency, tasks.length));
  await Promise.all(Array.from({length:n}, worker));
  if (firstErr!==undefined) throw firstErr;
  return results;
}`);
  const g = await P.asyncpool!.grade(d);
  expect("asyncpool good", `${g.passed}/${g.total}`, "5/5");
  if (g.fails.length) process.stdout.write("    " + g.fails.join("\n    ") + "\n");
  rmSync(d, { recursive: true, force: true });
}

// ---- CLI todo: reference → 6/6 ----
{
  const d = ws();
  writeFileSync(join(d, "todo.mjs"), `
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const F = "todos.json";
const load = () => existsSync(F) ? JSON.parse(readFileSync(F,"utf8")) : { seq:0, items:[] };
const save = (s) => writeFileSync(F, JSON.stringify(s));
const [cmd, ...rest] = process.argv.slice(2);
const s = load();
if (cmd === "add") { const text = rest.join(" "); const id = ++s.seq; s.items.push({id, text, done:false}); save(s); console.log(\`added #\${id}: \${text}\`); }
else if (cmd === "list") { for (const it of s.items.sort((a,b)=>a.id-b.id)) console.log(\`\${it.id} [\${it.done?"x":" "}] \${it.text}\`); }
else if (cmd === "done") { const id=Number(rest[0]); const it=s.items.find(x=>x.id===id); if(it){it.done=true; save(s);} console.log(\`done #\${id}\`); }
else if (cmd === "rm") { const id=Number(rest[0]); s.items = s.items.filter(x=>x.id!==id); save(s); console.log(\`removed #\${id}\`); }`);
  const g = await P.cli!.grade(d);
  expect("cli good", `${g.passed}/${g.total}`, "6/6");
  if (g.fails.length) process.stdout.write("    " + g.fails.join("\n    ") + "\n");
  rmSync(d, { recursive: true, force: true });
}

// ---- Framework: reference → 7/7 ----
{
  const d = ws();
  cpSync(resolve("eval/projects/_ref/app.mjs"), join(d, "app.mjs"));
  const g = await P.framework!.grade(d);
  expect("framework good", `${g.passed}/${g.total}`, "7/7");
  if (g.fails.length) process.stdout.write("    " + g.fails.join("\n    ") + "\n");
  rmSync(d, { recursive: true, force: true });
}

// ---- Store: reference → 7/7 ----
{
  const d = ws();
  cpSync(resolve("eval/projects/_ref/store.mjs"), join(d, "store.mjs"));
  const g = await P.store!.grade(d);
  expect("store good", `${g.passed}/${g.total}`, "7/7");
  if (g.fails.length) process.stdout.write("    " + g.fails.join("\n    ") + "\n");
  rmSync(d, { recursive: true, force: true });
}

// ---- Full-stack: reference server → 10/10 (spawns a real HTTP server) ----
{
  const d = ws();
  cpSync(resolve("eval/projects/_ref/server.mjs"), join(d, "server.mjs"));
  const g = await P.fullstack!.grade(d);
  expect("fullstack good", `${g.passed}/${g.total}`, "10/10");
  if (g.fails.length) process.stdout.write("    " + g.fails.join("\n    ") + "\n");
  rmSync(d, { recursive: true, force: true });
}

process.stdout.write(ok ? "\n✅ all graders validated\n" : "\n❌ grader validation FAILED\n");
process.exit(ok ? 0 : 1);

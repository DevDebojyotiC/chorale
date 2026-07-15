/**
 * Real-engineering benchmark. Unlike the single-file ramp, each project is a
 * multi-file / multi-step task graded with PARTIAL CREDIT by running the result:
 *   1. build   — a KV-store library (TTL + LRU) across src/store.mjs + src/index.mjs
 *   2. debug   — fix planted bugs in a broken multi-file lib until its tests pass
 *   3. async   — a bounded-concurrency promise pool with order + error semantics
 *   4. cli     — a stateful todo CLI persisting to JSON across processes
 * The coder runs with its full toolset (incl. bash, so it can run tests and iterate).
 *
 * Usage: npx tsx eval/coder-projects.ts ["model1" "model2" ...]
 */
import "dotenv/config";
process.env.CHORALE_NO_LEARN = "1"; // reproducible benchmarks: no self-learning
import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";

const rawArgs = process.argv.slice(2);
const onlyArg = rawArgs.find((x) => x.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;
const repeatArg = rawArgs.find((x) => x.startsWith("--repeat="));
const REPEAT = repeatArg ? Math.max(1, Number(repeatArg.slice("--repeat=".length)) || 1) : 1;
const modelArgs = rawArgs.filter((x) => !x.startsWith("--"));
const MODELS = modelArgs.length
  ? modelArgs
  : ["hf:google/gemma-4-31B-it", "fireworks:accounts/fireworks/models/gpt-oss-120b", "fireworks:accounts/fireworks/models/minimax-m2p7"];

const freePort = (): Promise<number> =>
  new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });

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

const CHECK_TIMEOUT_MS = 15_000;
async function scoreChecks(checks: Check[]): Promise<Grade> {
  let passed = 0;
  const fails: string[] = [];
  for (const [name, fn] of checks) {
    try {
      // Per-check timeout: model code (e.g. a route handler that never responds)
      // must not stall the whole benchmark.
      await Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, rej) => setTimeout(() => rej(new Error("check timed out (" + CHECK_TIMEOUT_MS / 1000 + "s)")), CHECK_TIMEOUT_MS)),
      ]);
      passed += 1;
    } catch (e) { fails.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
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

  // ---------- Tier 2 — advanced engineering ----------
  {
    id: "framework", title: "Mini web framework (routing + middleware)", skill: "framework", maxSteps: 18,
    prompt:
      "Build a minimal Express-like web framework in app.mjs (ESM, Node built-ins only). Export `createApp()` returning an `app` with:\n" +
      "• app.use(fn) — register global middleware (req, res, next) run in order for EVERY request.\n" +
      "• app.get(path, handler) and app.post(path, handler) — routes. Paths may contain params like /users/:id, parsed onto req.params.\n" +
      "• On req: `method`, `path`, `params`, `query` (parsed from the ?a=1&b=2 query string), and `body` (the JSON-parsed request body for POST).\n" +
      "• On res: `status(code)` (sets status, returns res for chaining), `json(obj)` (respond with JSON at the current status, default 200), `send(str)`, `end()`.\n" +
      "• app.inject({ method, url, body }) → Promise resolving to { statusCode, body } where body is the response body as a STRING. It runs the middleware chain, then the matching route handler. A middleware calls next() to continue; if a middleware sends a response, remaining middleware and the handler are skipped. If no route matches, respond 404.\n" +
      "No external packages.",
    grade: async (dir) => {
      const m = await tryImport(join(dir, "app.mjs"));
      const createApp = (m?.createApp ?? m?.default) as (() => Mod) | undefined;
      if (typeof createApp !== "function") return { passed: 0, total: 7, fails: ["no createApp export"] };
      const app = createApp();
      app.use((req: Mod, _res: Mod, next: () => void) => { req.hits = (req.hits || 0) + 1; next(); });
      app.use((req: Mod, res: Mod, next: () => void) => { if (req.path === "/blocked") res.status(401).json({ error: "no" }); else next(); });
      app.get("/health", (req: Mod, res: Mod) => res.json({ ok: true, hits: req.hits }));
      app.get("/users/:id", (req: Mod, res: Mod) => res.json({ id: req.params.id }));
      app.get("/search", (req: Mod, res: Mod) => res.json({ q: req.query.q }));
      app.post("/echo", (req: Mod, res: Mod) => res.status(201).json({ got: req.body }));
      app.get("/blocked", (_req: Mod, res: Mod) => res.json({ reached: true }));
      const inj = async (o: Mod): Promise<{ statusCode: number; json: Mod }> => {
        const r = await (app.inject as (x: Mod) => Promise<{ statusCode: number; body: string }>)(o);
        let j: Mod = {};
        try { j = JSON.parse(r.body); } catch { /* non-json */ }
        return { statusCode: r.statusCode, json: j };
      };
      return scoreChecks([
        ["GET returns json (200)", async () => { const r = await inj({ method: "GET", url: "/health" }); a(r.statusCode === 200 && r.json.ok === true, "health " + JSON.stringify(r)); }],
        ["middleware ran once", async () => { const r = await inj({ method: "GET", url: "/health" }); a(r.json.hits === 1, "hits " + r.json.hits); }],
        ["route params", async () => { const r = await inj({ method: "GET", url: "/users/42" }); a(String(r.json.id) === "42", "id " + JSON.stringify(r.json)); }],
        ["query parsing", async () => { const r = await inj({ method: "GET", url: "/search?q=hi" }); a(r.json.q === "hi", "q " + JSON.stringify(r.json)); }],
        ["unknown route → 404", async () => { const r = await inj({ method: "GET", url: "/nope" }); a(r.statusCode === 404, "status " + r.statusCode); }],
        ["POST body + status(201)", async () => { const r = await inj({ method: "POST", url: "/echo", body: { a: 1 } }); a(r.statusCode === 201 && r.json.got && r.json.got.a === 1, "echo " + JSON.stringify(r)); }],
        ["middleware short-circuits", async () => { const r = await inj({ method: "GET", url: "/blocked" }); a(r.statusCode === 401 && r.json.reached === undefined, "blocked " + JSON.stringify(r)); }],
      ]);
    },
  },
  {
    id: "store", title: "Redux-like state store (reducers + middleware)", skill: "state", maxSteps: 16,
    prompt:
      "Build a Redux-like state container in store.mjs (ESM, Node built-ins only). Export:\n" +
      "• createStore(reducer, preloadedState, enhancer): a store with getState(); dispatch(action) (runs the reducer, updates state, calls every subscriber, returns the action); subscribe(listener) (returns an unsubscribe function). If `enhancer` is a function, return enhancer(createStore)(reducer, preloadedState).\n" +
      "• combineReducers(reducersObject): returns one reducer producing an object whose keys are slices, each updated by its own reducer.\n" +
      "• applyMiddleware(...middlewares): returns an enhancer. Each middleware has the signature store => next => action => result and they compose so the first wraps the rest and the innermost next is the base dispatch. Middleware receives a store exposing getState and the fully-wrapped dispatch (so a thunk middleware can dispatch function actions).\n" +
      "No external packages.",
    grade: async (dir) => {
      const m = await tryImport(join(dir, "store.mjs"));
      const createStore = m?.createStore as ((r: Mod, s?: Mod, e?: Mod) => Mod) | undefined;
      const combineReducers = m?.combineReducers as ((o: Mod) => Mod) | undefined;
      const applyMiddleware = m?.applyMiddleware as ((...mw: Mod[]) => Mod) | undefined;
      if (typeof createStore !== "function") return { passed: 0, total: 7, fails: ["no createStore export"] };
      const counter = (s: Mod = { count: 0 }, act: Mod): Mod => act.type === "inc" ? { count: s.count + 1 } : act.type === "add" ? { count: s.count + (act.n as number) } : s;
      return scoreChecks([
        ["dispatch updates state", () => { const st = createStore(counter, { count: 0 }); st.dispatch({ type: "inc" }); a(st.getState().count === 1, "count " + st.getState().count); }],
        ["preloaded state", () => { const st = createStore(counter, { count: 5 }); a(st.getState().count === 5, "pre " + st.getState().count); }],
        ["dispatch returns action", () => { const st = createStore(counter, { count: 0 }); const r = st.dispatch({ type: "inc" }); a(r && r.type === "inc", "ret"); }],
        ["subscribe + unsubscribe", () => { const st = createStore(counter, { count: 0 }); let n = 0; const un = st.subscribe(() => { n += 1; }); st.dispatch({ type: "inc" }); st.dispatch({ type: "inc" }); un(); st.dispatch({ type: "inc" }); a(n === 2, "notified " + n); }],
        ["combineReducers slices", () => { if (typeof combineReducers !== "function") throw new Error("no combineReducers"); const root = combineReducers({ a: counter, b: counter }); const st = createStore(root); st.dispatch({ type: "inc" }); const s = st.getState(); a(s.a.count === 1 && s.b.count === 1, "slices " + JSON.stringify(s)); }],
        ["applyMiddleware (thunk)", () => { if (typeof applyMiddleware !== "function") throw new Error("no applyMiddleware"); const thunk = (store: Mod) => (next: (a: Mod) => Mod) => (action: Mod) => typeof action === "function" ? (action as (d: Mod, g: () => Mod) => unknown)(store.dispatch, store.getState) : next(action); const st = createStore(counter, { count: 0 }, applyMiddleware(thunk)); (st.dispatch as (a: unknown) => unknown)((d: (a: Mod) => void) => { d({ type: "add", n: 3 }); }); a(st.getState().count === 3, "thunk " + st.getState().count); }],
        ["middleware sees getState", () => { if (typeof applyMiddleware !== "function") throw new Error("no applyMiddleware"); let seen = -1; const spy = (store: Mod) => (next: (a: Mod) => Mod) => (action: Mod) => { const r = next(action); seen = store.getState().count; return r; }; const st = createStore(counter, { count: 0 }, applyMiddleware(spy)); st.dispatch({ type: "inc" }); a(seen === 1, "seen " + seen); }],
      ]);
    },
  },
  {
    id: "fullstack", title: "End-to-end full-stack task app (server + REST + persistence + UI)", skill: "fullstack", maxSteps: 24,
    prompt:
      "Build a full-stack 'task manager' web app using ONLY Node built-ins (no npm packages). Create server.mjs, started with `node server.mjs`, listening on the port in process.env.PORT (default 3000). It must provide:\n" +
      "1. A REST API (Content-Type application/json):\n" +
      "   • GET /api/tasks → 200, a JSON array of tasks, each { id, title, done }.\n" +
      "   • POST /api/tasks with JSON body { title } → 201, the created task (server assigns an integer id, done=false).\n" +
      "   • PATCH /api/tasks/:id with a JSON body (e.g. { done:true } or { title }) → 200 with the updated task, or 404 if the id does not exist.\n" +
      "   • DELETE /api/tasks/:id → 204 (empty body), or 404 if the id does not exist.\n" +
      "2. A frontend at GET / → 200 with Content-Type text/html: an HTML page containing a <form> to add a task and a <script> that fetch()es /api/tasks and renders them into the page.\n" +
      "3. Persistence: tasks are stored in a tasks.json file in the current directory so they survive restarts (create it if missing).\n" +
      "4. Any unknown route → 404. Parse JSON request bodies.\n" +
      "You do NOT need to run or test the server yourself — it will be started and exercised automatically. Just write the file(s).",
    grade: async (dir) => {
      if (!existsSync(join(dir, "server.mjs"))) return { passed: 0, total: 10, fails: ["no server.mjs"] };
      const port = await freePort();
      const base = `http://127.0.0.1:${port}`;
      const child = spawn("node", ["server.mjs"], { cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
      let up = false;
      for (let i = 0; i < 45; i++) {
        try { await fetch(base + "/api/tasks"); up = true; break; } catch { await delay(200); }
      }
      const firstId = async (): Promise<number> => { const r = await fetch(base + "/api/tasks"); const arr = (await r.json()) as Mod[]; return (arr.find((x) => x.title === "Buy milk") ?? arr[0])?.id as number; };
      let grade: Grade;
      try {
        grade = !up
          ? { passed: 0, total: 10, fails: ["server did not start (port " + port + ")"] }
          : await scoreChecks([
            ["GET /api/tasks → array", async () => { const r = await fetch(base + "/api/tasks"); a(r.status === 200, "status " + r.status); a(Array.isArray(await r.json()), "array"); }],
            ["API is application/json", async () => { const r = await fetch(base + "/api/tasks"); a((r.headers.get("content-type") ?? "").includes("application/json"), "ctype " + r.headers.get("content-type")); }],
            ["POST creates (201 + task)", async () => { const r = await fetch(base + "/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Buy milk" }) }); a(r.status === 201, "status " + r.status); const t = (await r.json()) as Mod; a(t.id !== undefined && t.title === "Buy milk" && t.done === false, "task " + JSON.stringify(t)); }],
            ["GET lists the created task", async () => { const arr = (await (await fetch(base + "/api/tasks")).json()) as Mod[]; a(arr.some((x) => x.title === "Buy milk"), "listed"); }],
            ["PATCH toggles done (200)", async () => { const id = await firstId(); const r = await fetch(`${base}/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ done: true }) }); a(r.status === 200, "status " + r.status); a(((await r.json()) as Mod).done === true, "done"); }],
            ["DELETE removes (204 + gone)", async () => { const id = await firstId(); const r = await fetch(`${base}/api/tasks/${id}`, { method: "DELETE" }); a(r.status === 204, "status " + r.status); const arr = (await (await fetch(base + "/api/tasks")).json()) as Mod[]; a(!arr.some((x) => x.id === id), "gone"); }],
            ["PATCH missing id → 404", async () => { const r = await fetch(`${base}/api/tasks/999999`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ done: true }) }); a(r.status === 404, "status " + r.status); }],
            ["unknown route → 404", async () => { const r = await fetch(base + "/nope"); a(r.status === 404, "status " + r.status); }],
            ["GET / serves an HTML UI", async () => { const r = await fetch(base + "/"); a(r.status === 200, "status " + r.status); a((r.headers.get("content-type") ?? "").includes("text/html"), "html ctype"); const h = await r.text(); a(/<form/i.test(h) && /<script/i.test(h), "form+script"); }],
            ["frontend + persistence wired", async () => { const h = await (await fetch(base + "/")).text(); a(/\/api\/tasks/.test(h), "frontend calls /api/tasks"); await fetch(base + "/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "persisted" }) }); await delay(120); a(existsSync(join(dir, "tasks.json")) && /persisted/.test(readFileSync(join(dir, "tasks.json"), "utf8")), "tasks.json persisted"); }],
          ]);
      } finally {
        try { child.kill(); } catch { /* ignore */ }
        try { if (child.pid) execFileSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" }); } catch { /* ignore */ }
      }
      return grade;
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
const projects = ONLY ? PROJECTS.filter((p) => ONLY.includes(p.id)) : PROJECTS;

process.stdout.write(`\n########## REAL-ENGINEERING BENCHMARK ##########\n`);
process.stdout.write(`Projects: ${projects.map((p) => p.id).join(", ")}\nModels: ${MODELS.join(", ")}\n`);

interface RunResult2 { grade: Grade; secs: number; inTok: number; outTok: number }
async function runOnce(model: string, proj: Project): Promise<RunResult2> {
  const ws = mkdtempSync(join(tmpdir(), `chorale-proj-${proj.id}-`));
  if (proj.setup) proj.setup(ws);
  const t0 = Date.now();
  let grade: Grade = { passed: 0, total: 1, fails: ["did not run"] };
  let inTok = 0, outTok = 0;
  try {
    process.chdir(ws);
    const res = await raceTimeout(
      runAgent({ config, registry, agent: coder, prompt: proj.prompt, modelOverride: model, permissionMode: "full-auto", stream: false, maxSteps: proj.maxSteps }),
      HARD_TIMEOUT_MS,
    );
    process.chdir(repoRoot);
    if (res !== "TIMEOUT") { inTok = res.usage?.inputTokens ?? 0; outTok = res.usage?.outputTokens ?? 0; }
    grade = res === "TIMEOUT" ? { passed: 0, total: 1, fails: ["TIMEOUT"] } : await proj.grade(ws);
  } catch (e) {
    process.chdir(repoRoot);
    grade = { passed: 0, total: 1, fails: ["harness error: " + (e instanceof Error ? e.message : String(e))] };
  } finally {
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  return { grade, secs: Math.round((Date.now() - t0) / 1000), inTok, outTok };
}

// Repeat mode: run each model×project REPEAT times and report a reliability distribution.
if (REPEAT > 1) {
  for (const model of MODELS) {
    process.stdout.write(`\n===== ${model.replace(/.*\//, "")} (×${REPEAT}) =====\n`);
    for (const proj of projects) {
      let fullPass = 0, sumP = 0, sumT = 0, sumSecs = 0;
      for (let k = 1; k <= REPEAT; k++) {
        const r = await runOnce(model, proj);
        const ok = r.grade.passed === r.grade.total;
        if (ok) fullPass += 1;
        sumP += r.grade.passed; sumT += r.grade.total; sumSecs += r.secs;
        process.stdout.write(`  ${proj.id} #${String(k).padStart(2)}  ${r.grade.passed}/${r.grade.total}  (${r.secs}s)${ok ? "" : "  ✗ " + r.grade.fails.slice(0, 2).join(" | ").slice(0, 120)}\n`);
      }
      process.stdout.write(`  → ${proj.id}: FULL-PASS ${fullPass}/${REPEAT} trials · mean ${Math.round((sumP / sumT) * 100)}% · avg ${Math.round(sumSecs / REPEAT)}s\n`);
    }
  }
  process.exit(0);
}

interface Row { model: string; cells: Record<string, Grade>; inTok: number; outTok: number; secs: number }
const rows: Row[] = [];

for (const model of MODELS) {
  process.stdout.write(`\n===== ${model.replace(/.*\//, "")} =====\n`);
  const row: Row = { model, cells: {}, inTok: 0, outTok: 0, secs: 0 };
  for (const proj of projects) {
    const r = await runOnce(model, proj);
    row.secs += r.secs; row.inTok += r.inTok; row.outTok += r.outTok;
    row.cells[proj.id] = r.grade;
    const pct = Math.round((r.grade.passed / r.grade.total) * 100);
    process.stdout.write(`  ${proj.id.padEnd(9)} ${r.grade.passed}/${r.grade.total}  (${pct}%, ${r.secs}s)${r.grade.fails.length ? "  ✗ " + r.grade.fails.slice(0, 3).join(" | ").slice(0, 160) : ""}\n`);
  }
  rows.push(row);
}

// ---- Summary ----
process.stdout.write(`\n\n########## RESULTS ##########\n\n`);
const head = ["model".padEnd(14), ...projects.map((p) => p.id.padEnd(9)), "overall", "in tok", "out tok", "sec", "cost$"];
process.stdout.write(head.join("  ") + "\n");
for (const r of rows) {
  let sp = 0, st = 0;
  const cells = projects.map((p) => { const g = r.cells[p.id]!; sp += g.passed; st += g.total; return `${g.passed}/${g.total}`.padEnd(9); });
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

/**
 * Seed the playbook from the hand-written diagnose registry (Phase 4 · escalate-last).
 *
 * `diagnose.ts` already encodes the fixes for the error classes we hit most (ESM/CJS, hardcoded port,
 * template-literal traps, …). Those are exactly the "verified fixes" the playbook's recall rung wants
 * — so we seed them as entries on first use. This means the playbook is never cold: the very first
 * failure of a known class already has a fix to inject, before the system has learned anything itself.
 *
 * The diagnose hint stays the source of truth for the fix text; this module adds only the retrieval
 * metadata (a representative error sample + keywords) each seed needs to be found. Seeding is
 * idempotent — entries already present (by title) are skipped, so it is safe to call every run.
 */

import { DIAGNOSES } from "./diagnose.js";
import { fingerprint, type Playbook } from "./playbook.js";

interface SeedMeta {
  /** A representative error string, so recall can match real errors of this class. */
  sample: string;
  title: string;
  keywords: string[];
  rootCause: string;
}

const SEED_META: Record<string, SeedMeta> = {
  "template-literal": {
    sample: "SyntaxError: Unterminated template literal in server.js — inline HTML with a nested backtick",
    title: "HTML in a JS template literal breaks on a nested backtick",
    keywords: ["template", "literal", "backtick", "unterminated", "html"],
    rootCause: "a large HTML page embedded in a JS template literal — a nested backtick closes the string early",
  },
  "esm-cjs": {
    sample: "SyntaxError: Cannot use import statement outside a module (require is not defined / module.exports)",
    title: "ESM/CJS mismatch (require or module.exports in an ES module)",
    keywords: ["import", "statement", "outside", "module", "require", "exports", "commonjs"],
    rootCause: "mixing CommonJS (require / module.exports) with ESM in a type:module project",
  },
  "module-path": {
    sample: "Error: Cannot find module './util' — ERR_MODULE_NOT_FOUND, failed to resolve import",
    title: "Unresolved module path or missing file extension",
    keywords: ["cannot", "find", "module", "resolve", "err_module_not_found"],
    rootCause: "a wrong relative path, a missing file extension, or importing a file that was never created",
  },
  port: {
    sample: "Error: listen EADDRINUSE address already in use — hardcoded port",
    title: "Hardcoded port already in use",
    keywords: ["eaddrinuse", "address", "already", "listen", "port"],
    rootCause: "the port is hardcoded instead of read from process.env.PORT",
  },
  "bad-export": {
    sample: "TypeError: handler is not a function — wrong import/export name",
    title: "Called a non-function (wrong import/export name)",
    keywords: ["function", "typeerror", "import", "export", "name"],
    rootCause: "an import/export name mismatch, so the imported value isn't the function you call",
  },
  "undefined-name": {
    sample: "ReferenceError: foo is not defined",
    title: "Name used but never declared or imported",
    keywords: ["defined", "referenceerror", "undeclared"],
    rootCause: "an identifier is used without being declared or imported",
  },
  "async-syntax": {
    sample: "SyntaxError: await is only valid in async functions and the top level",
    title: "await or a reserved word used outside an async function",
    keywords: ["await", "valid", "async", "reserved", "word"],
    rootCause: "await used outside an async function (or a reserved word misused)",
  },
  "literal-newline": {
    sample: "unexpected literal \\n escape sequence in source instead of a real newline",
    title: "Literal \\n written instead of a real newline",
    keywords: ["literal", "newline", "escape", "sequence"],
    rootCause: "literal backslash-n sequences were emitted into source instead of real line breaks",
  },
  delimiters: {
    sample: "SyntaxError: Unexpected end of input — missing closing brace or paren",
    title: "Unbalanced bracket, paren, or quote",
    keywords: ["unexpected", "input", "missing", "unterminated", "brace", "paren"],
    rootCause: "a bracket, paren, brace, quote, or comma is missing or extra",
  },
};

/** A fully-specified seed (used for the runnability-gate classes, which aren't in the diagnose registry). */
interface SeedSpec {
  sample: string;
  title: string;
  keywords: string[];
  rootCause: string;
  solution: string;
  context: string;
}

/**
 * Runnability-gate seeds. The runnable.ts checks catch a build that won't run (no entry point, a start
 * script pointing at a missing file, unmounted routers, missing .env, frontend/backend path mismatch,
 * a dangling local import). These are the failures the ladder meets most on a fullstack build — and
 * the live run hit "broken-start" with a cold playbook. Seeding them means the very first occurrence
 * already has a concrete, verified fix to recall.
 */
const RUNNABLE_SEEDS: Omit<SeedSpec, "context">[] = [
  {
    sample: `package.json: the "start" script runs "index.js", which does not exist — create it or fix the script.`,
    title: "Start script points at a missing entry file",
    keywords: ["start", "script", "runs", "exist", "package.json", "entry"],
    rootCause: "the package.json start/dev script names a file that was never created (or the entry file has a different name)",
    solution:
      "Make the start script and the entry file agree: either create the named entry file (e.g. index.js) that boots the server, or change the \"start\" script to point at the file you actually created (e.g. \"node src/server.js\"). That entry file must mount the routes and call app.listen(process.env.PORT).",
  },
  {
    sample: "project: depends on a server framework but nothing calls .listen() and there is no start entry point — the server never boots.",
    title: "Server framework present but no entry point boots it",
    keywords: ["depends", "server", "framework", "nothing", "listen", "entry", "boots"],
    rootCause: "controllers/routes/models were written but no file creates the app and calls .listen()",
    solution:
      "Create ONE server entry file in the SAME folder as the backend code (if the code is in backend/, put it in backend/ — do NOT invent a src/ folder). It must: create the framework app, apply middleware, IMPORT AND MOUNT EVERY router that exists under routes/ with app.use('/api/<name>', router), read the port from process.env.PORT, and call app.listen. Then set package.json \"main\" and the \"start\"/\"dev\" scripts to that exact file. This one file is what makes the whole app boot — write it in full.",
  },
  {
    sample: "router file defines API routes but the server never mounts it with app.use('/…', router) — its endpoints are not reachable.",
    title: "Router defined but never mounted on the server",
    keywords: ["defines", "routes", "server", "never", "mounts", "router", "reachable", "endpoints"],
    rootCause: "a router module exports its routes but the server entry never imports and app.use()s it",
    solution:
      "In the server entry file, import each router and mount it, e.g. `import notesRouter from './routes/notes.js'; app.use('/api/notes', notesRouter);`. Mount every router the project defines, under the base path the frontend calls.",
  },
  {
    sample: "project: reads required secrets from process.env (e.g. JWT_SECRET) but there is no .env file — create a real .env.",
    title: "Required secret read from env but no .env exists",
    keywords: ["reads", "secrets", "process", "env", "jwt_secret", "file"],
    rootCause: "code reads process.env.JWT_SECRET (or DATABASE_URL, etc.) but only a .env.example (or nothing) is on disk, so the value is undefined at runtime",
    solution:
      "Create a real .env with the required keys and safe development defaults (e.g. JWT_SECRET=dev-secret-change-me), load it with `import 'dotenv/config'` at the top of the entry file, and document the vars in the README. Fall back to a dev default when a secret is missing so it never crashes on boot.",
  },
  {
    sample: "the frontend calls API paths that match none of the backend's endpoints — requests will not reach the server. Align the base URL and paths.",
    title: "Frontend calls paths the backend does not serve",
    keywords: ["frontend", "calls", "paths", "match", "backend", "endpoints", "align", "base"],
    rootCause: "the frontend's base URL / route prefixes don't match the backend's actual mounted routes (e.g. it calls /login while the backend serves /api/auth/login)",
    solution:
      "Treat the backend's mounted routes as the source of truth. In the frontend API client, set ONE API base (e.g. baseURL = '/api') and rewrite each request path so it resolves to a real backend endpoint (base + path === a route the backend serves). Only call endpoints the backend actually has; if one is genuinely missing, add that route on the backend instead.",
  },
  {
    sample: "npm install failed for the backend — No matching version found for a dependency (ETARGET) — package.json pins a version that was never published.",
    title: "Dependency pinned to a version that does not exist on npm",
    keywords: ["npm", "install", "matching", "version", "etarget", "dependency", "package"],
    rootCause: "package.json pins a dependency to a version that was never published (often an invented/hallucinated version), so npm cannot resolve it",
    solution:
      "For each failing dependency, set a version range that actually exists on npm — use a caret range on a real published version (or drop the exact pin). Never invent version numbers. Then `npm install` must succeed cleanly.",
  },
  {
    sample: "a source file imports './db', which does not exist in the project — create the missing file or fix the path.",
    title: "Local import resolves to a file that does not exist",
    keywords: ["imports", "exist", "project", "create", "missing", "path", "file"],
    rootCause: "an import points at a relative path with no matching file — wrong path, wrong extension (.js vs .ts), or the file was never created",
    solution:
      "First check whether the SAME file exists under a different extension or path (e.g. it imports './x.js' but the file is './x.ts', or './utils/errors.js' when the error helper lives in './middleware/error') — if so, fix the import to point at the real file. Otherwise CREATE the missing module at that path with the exports the importer uses. Never leave an import pointing at a nonexistent file.",
  },
];

/** Every seed: the diagnose-derived runtime/syntax fixes plus the runnability-gate fixes. */
function allSeeds(): SeedSpec[] {
  const fromDiagnose: SeedSpec[] = [];
  for (const d of DIAGNOSES) {
    const meta = SEED_META[d.key];
    if (meta) fromDiagnose.push({ ...meta, solution: d.hint, context: "general" });
  }
  return [...fromDiagnose, ...RUNNABLE_SEEDS.map((s) => ({ ...s, context: "runnability" }))];
}

/** How many distinct fixes the seeder knows about (diagnose-derived + runnability). */
export function seedCount(): number {
  return allSeeds().length;
}

/** Add any seed entries the playbook doesn't already have. Returns how many were added. */
export function seedPlaybook(pb: Playbook, at: number = Date.now()): number {
  const existing = new Set(pb.entries().map((e) => e.title));
  let added = 0;
  for (const s of allSeeds()) {
    if (existing.has(s.title)) continue;
    pb.add(
      {
        signature: fingerprint(s.sample),
        keywords: s.keywords,
        title: s.title,
        symptom: s.sample,
        rootCause: s.rootCause,
        solution: s.solution,
        failedAttempts: [],
        context: s.context,
        source: "seeded",
      },
      at,
    );
    added++;
  }
  return added;
}

let seeded = false;
/** Seed the given playbook once per process (idempotent + cheap thereafter). */
export function ensureSeeded(pb: Playbook): void {
  if (seeded) return;
  seedPlaybook(pb);
  seeded = true;
}

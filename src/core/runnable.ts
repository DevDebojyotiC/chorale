/**
 * Runnability gate (Phase 4 · fullstack lever #3).
 *
 * A build can produce lots of files and still not run: the last fullstack experiment shipped a
 * backend with controllers/models but NO server entry point (nothing calls .listen()), and an
 * earlier one couldn't log in because it required JWT_SECRET with only a .env.example on disk.
 * Nothing caught either — the coder's verify checks each file compiles, but nobody asks "does the
 * app actually run?". This module answers that deterministically: per package.json unit it flags a
 * server with no entry point, a start script pointing at a missing file, required env vars with no
 * .env, and any local import that resolves to nothing (incoherence). Pure/testable — no execution.
 */

import { extractContract, type SourceFile } from "./contract.js";

export interface RunnableIssue {
  kind: "no-entry" | "broken-start" | "unrunnable-entry" | "missing-import" | "missing-env" | "unmounted-routes" | "unexposed-feature" | "frontend-backend-mismatch" | "missing-endpoint";
  where?: string;
  message: string;
}

/** Reduce a URL or path to a comparable path: strip scheme+host, query/hash; params → :p. */
function pathOnly(u: string): string {
  let p = u.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "");
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/(?::\w+|\$\{[^}]+\}|\d+)(?=\/|$)/g, "/:p").replace(/\/+$/, "");
  return p || "/";
}

/**
 * Cross-consumer contract check (fullstack frontier): the backend serves a set of endpoints; the
 * frontend calls a set of URLs. If the frontend's paths match NONE of the backend's, the frontend is
 * pointed at the wrong base/prefix (the exact all-four-run failure: frontend called /login while the
 * backend served /api/auth/login) — the app can't work. Flag it so the repair aligns them.
 */
interface ContractDetail {
  /** Full "METHOD /path" the backend actually serves. */
  backendEndpoints: string[];
  backendPaths: Set<string>;
  frontendCalls: Set<string>;
  bases: string[];
  feFiles: string[];
  matched: boolean;
}

/** Extract both sides of the frontend↔backend API contract, or null if one side is absent. */
function analyzeContract(files: SourceFile[]): ContractDetail | null {
  const backendEndpoints = extractContract(files).endpoints.filter((e) => /^(GET|POST|PUT|PATCH|DELETE)\s/.test(e));
  // extractContract may append a note ("GET /  (defined in src/routes/x)") — keep only the path token,
  // else the note becomes part of the "path" and every comparison against it silently fails.
  const backendPaths = new Set(backendEndpoints.map((e) => pathOnly(e.replace(/^\w+\s+/, "").trim().split(/\s+/)[0] ?? "")));
  if (backendPaths.size === 0) return null;
  const feFiles = files.filter((f) => isCode(f.path) && /\b(axios|fetch)\b/.test(f.content) && !/\bexpress\b|\.listen\s*\(/.test(f.content));
  if (feFiles.length === 0) return null;

  // Resolve simple string constants (e.g. `const BASE_URL = "http://localhost:3000"`) so a base URL or
  // a `${BASE_URL}/api/...` template call is compared by its REAL path — otherwise a perfectly-aligned
  // TS client gets false-flagged because ${BASE_URL} reads as a path param.
  const consts = new Map<string, string>();
  for (const f of feFiles) for (const m of f.content.matchAll(/\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*['"`]([^'"`]+)['"`]/g)) consts.set(m[1]!, m[2]!);
  const resolveTpl = (u: string): string => u.replace(/\$\{([A-Za-z_]\w*)\}/g, (_, n) => consts.get(n) ?? "");

  const basePaths = new Set<string>();
  for (const f of feFiles) {
    for (const m of f.content.matchAll(/\b(?:API_BASE_URL|API_URL|BASE_URL|baseURL)\b\s*[:=]\s*['"`]([^'"`]+)['"`]/g)) basePaths.add(pathOnly(resolveTpl(m[1]!)));
    for (const m of f.content.matchAll(/\b(?:API_BASE_URL|API_URL|BASE_URL|baseURL)\b\s*[:=]\s*([A-Za-z_]\w*)\b/g)) if (consts.has(m[1]!)) basePaths.add(pathOnly(consts.get(m[1]!)!));
  }
  const bases = basePaths.size ? [...basePaths] : ["/"];

  // A modern SPA centralizes the client (`const api = axios.create({baseURL})`) and calls `api.get(...)`
  // in page files that never mention axios. Trace the instance name(s) so those calls are seen — else
  // the check only sees the one file with a literal axios call and both misses and false-flags.
  const clientNames = new Set<string>(["axios"]);
  for (const f of feFiles) for (const m of f.content.matchAll(/\b(?:const|let|var|export)\s+(?:const\s+)?([A-Za-z_]\w*)\s*=\s*axios\.create\b/g)) clientNames.add(m[1]!);
  const isBackendUnit = (c: string): boolean => /\.listen\s*\(|from\s+['"]express['"]|require\(\s*['"]express['"]\)/.test(c);
  const callFiles = files.filter((f) => isCode(f.path) && !isBackendUnit(f.content));

  const called = new Set<string>();
  const addCall = (raw: string): void => {
    const u = resolveTpl(raw);
    if (/^https?:\/\//i.test(u)) called.add(pathOnly(u));
    else for (const b of bases) called.add(pathOnly((b === "/" ? "" : b) + "/" + u.replace(/^\//, "")));
  };
  const verbs = "get|post|put|patch|delete|request";
  for (const f of callFiles) {
    for (const name of clientNames) for (const m of f.content.matchAll(new RegExp(`\\b${name}\\.(?:${verbs})\\(\\s*['"\`]([^'"\`]+)['"\`]`, "g"))) addCall(m[1]!);
    for (const m of f.content.matchAll(/\bfetch\(\s*['"`]([^'"`]+)['"`]/g)) addCall(m[1]!);
  }
  if (called.size === 0) return null;

  return { backendEndpoints, backendPaths, frontendCalls: called, bases, feFiles: feFiles.map((f) => f.path), matched: [...called].some((c) => backendPaths.has(c)) };
}

/**
 * Cross-consumer contract check (fullstack frontier): the backend serves a set of endpoints; the
 * frontend calls a set of URLs. If the frontend's paths match NONE of the backend's, the frontend is
 * pointed at the wrong base/prefix (the exact all-four-run failure: frontend called /login while the
 * backend served /api/auth/login) — the app can't work. Flag it so the repair aligns them.
 */
/**
 * Frontend calls the backend does not serve, when the base URL is otherwise CORRECT. Only counted for
 * paths clearly aimed at this backend (sharing a top-level segment with a real route) so a call to an
 * unrelated third-party URL is never mistaken for a missing route.
 */
function missingEndpoints(d: ContractDetail): string[] {
  const prefixes = new Set([...d.backendPaths].map((p) => p.split("/")[1] ?? ""));
  return [...d.frontendCalls].filter((c) => !d.backendPaths.has(c) && prefixes.has(c.split("/")[1] ?? ""));
}

function checkFrontendBackendContract(files: SourceFile[]): RunnableIssue[] {
  const d = analyzeContract(files);
  if (!d) return [];
  if (!d.matched) {
    return [
      {
        kind: "frontend-backend-mismatch",
        where: "frontend",
        message: `the frontend calls API paths (${[...d.frontendCalls].slice(0, 4).join(", ")}) that match none of the backend's endpoints (${[...d.backendPaths].slice(0, 4).join(", ")}) — requests won't reach the server. Align the frontend's base URL and paths to the backend's actual routes.`,
      },
    ];
  }
  // The base is right, so the client is wired — but individual routes may simply not exist yet. These
  // 404 at runtime and no other gate can see them (the app boots and serves perfectly well).
  const missing = missingEndpoints(d);
  if (missing.length === 0) return [];
  return [
    {
      kind: "missing-endpoint",
      where: "backend",
      message: `the frontend calls ${missing.slice(0, 5).join(", ")}, which the backend does not serve — those requests will 404 at runtime. Add the missing route(s) to the backend, or correct the frontend path if it is the one that's wrong.`,
    },
  ];
}

/**
 * Contract-aware repair directive. The mismatch is never fixed by "align them" alone — the coder needs
 * BOTH sides concretely: what the backend actually serves vs what the frontend calls, plus which files
 * to edit. The backend routes are the source of truth (they're mounted and working), so steer the fix
 * into the frontend API client.
 */
export function contractDirective(files: SourceFile[]): string {
  const d = analyzeContract(files);
  if (!d) return "";
  return (
    `The frontend and backend disagree on API paths, so requests never reach the server. The BACKEND routes are the source of truth — align the FRONTEND to them.\n` +
    `Backend actually serves: ${d.backendEndpoints.slice(0, 12).join("; ")}.\n` +
    `Frontend currently calls: ${[...d.frontendCalls].slice(0, 8).join(", ")} (base URL: ${d.bases.join(", ")}).\n` +
    `Edit the frontend API client (${d.feFiles.slice(0, 4).join(", ")}): set ONE API base and rewrite every request path so it resolves to a real backend endpoint listed above — do not invent endpoints, use only paths the backend serves. If the frontend genuinely needs an endpoint the backend lacks, add that route on the backend instead. Write the corrected file(s) now.`
  );
}

const norm = (p: string): string => p.replace(/\\/g, "/");
const dirOf = (p: string): string => norm(p).split("/").slice(0, -1).join("/");

/** Is `name` (e.g. ".env") present in `dir` or any ancestor directory up to the project root? */
function envInDirOrAncestors(dir: string, allPaths: Set<string>, name: string): boolean {
  const parts = dir ? norm(dir).split("/") : [];
  for (let i = parts.length; i >= 0; i--) {
    const p = parts.slice(0, i).join("/");
    if (allPaths.has(p ? `${p}/${name}` : name)) return true;
  }
  return false;
}
const moduleKey = (p: string): string => norm(p).replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "").replace(/\/index$/, "");

/** Resolve an import specifier against the importing file's dir, to a comparable module tail.
 *  The importing file's directory is taken WITHOUT moduleKey's `/index` stripping — otherwise a file
 *  named `index.ts` loses both its `/index` and its parent segment, and every relative import resolves
 *  one directory too high (which made every router look unmounted whenever the entry was `index.ts`). */
function resolveTail(fromPath: string, spec: string): string {
  const dir = norm(fromPath).replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "").split("/").slice(0, -1);
  for (const seg of norm(spec).replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "").split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") dir.pop();
    else dir.push(seg);
  }
  return dir.join("/").replace(/\/index$/, "");
}
/**
 * Suffixes tried when resolving a module path (bare, extensions, index files). `.d.ts` and `.json`
 * are legal import targets (`import type` of a declaration file; CJS `require('./config')` backed by
 * config.json) — omitting them false-flagged both as missing imports. `/index.mjs` + `/index.cjs`
 * matter for barrel dirs: `require('./services')` backed by services/index.cjs is real wiring.
 */
const RESOLVE_SUFFIXES = ["", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".d.ts", ".json", "/index.js", "/index.ts", "/index.jsx", "/index.tsx", "/index.mjs", "/index.cjs"];
/** Asset imports we don't treat as code modules (avoid false "missing" on css/json/images). */
const ASSET_RE = /\.(css|scss|sass|less|json|svg|png|jpe?g|gif|webp|ico|md|txt|yml|yaml)$/i;

const isCode = (p: string): boolean => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p);

/** Resolve a relative import against the importing file to the ACTUAL file path, or null if none. */
function resolveLocalImport(fromPath: string, spec: string, allPaths: Set<string>): string | null {
  const parts = norm(fromPath).split("/").slice(0, -1);
  for (const seg of norm(spec).split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  const joined = parts.join("/");
  // A spec with an explicit code extension names an exact file — honor it before suffix-cycling, or
  // `./user.service.ts` would resolve to a stale sibling user.service.js and condemn the real .ts.
  if (/\.(js|ts|jsx|tsx|mjs|cjs)$/.test(joined) && allPaths.has(joined)) return joined;
  const target = joined.replace(/\.(js|ts|jsx|tsx|mjs|cjs)$/, "");
  for (const s of RESOLVE_SUFFIXES) if (allPaths.has(target + s)) return target + s;
  return null;
}

/** Resolve a relative import against the importing file, testing whether the target file exists. */
function localImportExists(fromPath: string, spec: string, allPaths: Set<string>): boolean {
  return resolveLocalImport(fromPath, spec, allPaths) !== null;
}

/** Every local (relative) import specifier in a file, excluding non-code assets. */
function localSpecs(content: string): string[] {
  // Drop line comments (line-start only — mid-line `//` may sit inside a URL string): commented-out
  // wiring (`// import bookingRoutes …`) must not count as a live reachability edge.
  const src = content.replace(/^[ \t]*\/\/.*$/gm, "");
  const out: string[] = [];
  for (const m of src.matchAll(/(?:\bfrom|\brequire\s*\(|\bimport)\s*['"`](\.[^'"`]+)['"`]/g)) if (!ASSET_RE.test(m[1]!)) out.push(m[1]!);
  // dynamic import("./x") — entry files commonly boot the app this way (`await import("./src/app.ts")`);
  // missing this edge breaks reachability from the entry and would condemn the whole feature layer.
  for (const m of src.matchAll(/\bimport\s*\(\s*['"`](\.[^'"`]+)['"`]/g)) if (!ASSET_RE.test(m[1]!)) out.push(m[1]!);
  return out;
}

/** Path-alias import specs (`@/x`, `~/x`, `#x`) the resolver cannot follow — the graph is unreliable. */
function hasAliasImports(content: string): boolean {
  return /(?:\bfrom|\brequire\s*\(|\bimport\s*\(?)\s*['"`](?:@\/|~\/|#)[^'"`]*['"`]/.test(content);
}

interface Pkg {
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Statically check whether the built project can run. `files` carries the content of code +
 * package.json + .env files; `allPaths` is every file path in the project (for resolution).
 */
export function checkRunnable(files: SourceFile[], allPaths: Set<string>): RunnableIssue[] {
  const issues: RunnableIssue[] = [];
  const code = files.filter((f) => isCode(f.path));
  const has = (rel: string): boolean => RESOLVE_SUFFIXES.some((s) => allPaths.has(rel.replace(/\.(js|ts|mjs|cjs)$/, "") + s));

  for (const pkgFile of files.filter((f) => norm(f.path).endsWith("package.json"))) {
    const dir = dirOf(pkgFile.path);
    const prefix = dir ? dir + "/" : "";
    let pkg: Pkg;
    try {
      pkg = JSON.parse(pkgFile.content) as Pkg;
    } catch {
      continue; // malformed package.json — a different problem
    }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const scripts = pkg.scripts ?? {};
    const unitCode = code.filter((f) => norm(f.path).startsWith(prefix));
    const isBackend = ["express", "fastify", "koa", "@hapi/hapi", "@nestjs/core", "hapi"].some((d) => d in deps);
    const isFramework = ["vite", "next", "react-scripts", "@vue/cli-service", "@angular/cli", "parcel"].some((d) => d in deps);
    const startsServer = unitCode.some((f) => /\.listen\s*\(/.test(f.content));

    // broken-start: a start/dev script runs a file that isn't there
    for (const key of ["start", "dev"]) {
      const cmd = scripts[key];
      if (typeof cmd !== "string") continue;
      const m = cmd.match(/\b(?:node|nodemon|ts-node|tsx|babel-node)\s+(?:--\S+\s+)*([^\s&|;]+)/);
      if (m && /[./]/.test(m[1]!) && !has(prefix + m[1]!.replace(/^\.\//, ""))) {
        issues.push({ kind: "broken-start", where: pkgFile.path, message: `${pkgFile.path}: the "${key}" script runs "${m[1]}", which does not exist — create it or fix the script.` });
      }
    }

    // unrunnable-entry: the start command is plain `node`, but the code it must load is TypeScript.
    // node cannot execute .ts — the app never starts. Skipped when a loader/transpiler is in play
    // (tsx / ts-node / --loader / --experimental-strip-types), which CAN run TypeScript.
    const startCmd = scripts.start ?? scripts.dev;
    if (typeof startCmd === "string" && /\bnode\b/.test(startCmd) && !/tsx|ts-node|--loader|--import|--experimental-strip-types|swc|babel|nodemon/.test(startCmd)) {
      const em = startCmd.match(/\bnode\s+(?:--\S+\s+)*([^\s&|;]+)/);
      if (em && /[./]/.test(em[1]!)) {
        const entryKey = (prefix + em[1]!.replace(/^\.\//, "")).replace(/\.(js|ts|mjs|cjs)$/, "");
        const entryFile = RESOLVE_SUFFIXES.map((s) => entryKey + s).find((p) => allPaths.has(p));
        const tsEntry = entryFile != null && /\.tsx?$/.test(entryFile);
        // …or a plain-JS file in this unit importing a module that only exists as TypeScript
        const jsImportsTs = unitCode.some(
          (f) => /\.(js|mjs|cjs)$/.test(f.path) && localSpecs(f.content).some((spec) => /\.tsx?$/.test(resolveLocalImport(f.path, spec, allPaths) ?? "")),
        );
        if (tsEntry || jsImportsTs) {
          issues.push({
            kind: "unrunnable-entry",
            where: dir || ".",
            message:
              `${pkgFile.path}: the start script runs plain node ("${startCmd}") but the code it loads is TypeScript` +
              (tsEntry ? ` — the entry "${entryFile}" is a .ts file` : ` — a .js file in this unit imports .ts modules`) +
              `. node cannot execute TypeScript, so the app never starts. Either write this unit in plain JavaScript, or add a build step (tsc) and point "start" at the compiled output, or run it through a loader (tsx / ts-node).`,
          });
        }
      }
    }

    // no-entry: a server framework is a dependency but nothing starts a server (no .listen, no framework runner)
    if (isBackend && !startsServer && !isFramework) {
      issues.push({ kind: "no-entry", where: dir || ".", message: `${dir || "project"}: depends on a server framework but nothing calls .listen() and there is no start entry point — the server never boots, so the app can't run. Add a server entry (e.g. server.js/app.js) that mounts the routes and listens on a port.` });
    }

    // missing-env: code needs env vars but only .env.example exists (the login/JWT_SECRET gap). A
    // shared .env commonly sits at the PROJECT ROOT, not beside a sub-module's package.json, and
    // dotenv loads it from the cwd — so accept a real .env in this dir OR any ancestor up to the root.
    const needsSecret = unitCode.some((f) => /process\.env\.(JWT_SECRET|SECRET|SESSION_SECRET|DATABASE_URL|DB_URL)/.test(f.content));
    const hasEnv = envInDirOrAncestors(dir, allPaths, ".env");
    if (needsSecret && !hasEnv) {
      issues.push({ kind: "missing-env", where: dir || ".", message: `${dir || "project"}: reads required secrets from process.env (e.g. JWT_SECRET) but there is no .env file${envInDirOrAncestors(dir, allPaths, ".env.example") ? " (only .env.example)" : ""} — create a real .env so it runs, and mention it in the README.` });
    }
  }

  // unmounted-routes: a router file defines endpoints but the server never app.use()s it — the app
  // boots but the API is dead (exactly the e2e failure: authRoutes/notesRoutes existed, server.js
  // only served /health). A server that starts isn't enough; its routes must be wired in.
  const routeFiles = code.filter(
    (f) => /\brouter\.(get|post|put|patch|delete)\s*\(/i.test(f.content) && /(module\.exports\s*=\s*router|export\s+default\s+router|export\s*\{\s*router)/.test(f.content),
  );
  if (routeFiles.length > 0) {
    const mountedTails = new Set<string>();
    for (const f of code) {
      const imported = new Map<string, string>();
      for (const m of f.content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) imported.set(m[1]!, resolveTail(f.path, m[2]!));
      for (const m of f.content.matchAll(/import\s+(\w+)\s+from\s+['"`]([^'"`]+)['"`]/g)) imported.set(m[1]!, resolveTail(f.path, m[2]!));
      for (const m of f.content.matchAll(/\bapp\.use\(\s*(?:['"`][^'"`]+['"`]\s*,\s*)?(\w+)/g)) {
        const tail = imported.get(m[1]!);
        if (tail) mountedTails.add(tail);
      }
    }
    for (const rf of routeFiles) {
      const key = moduleKey(rf.path);
      const mounted = [...mountedTails].some((t) => t === key || t.endsWith("/" + key) || key.endsWith("/" + t));
      if (!mounted) {
        issues.push({ kind: "unmounted-routes", where: rf.path, message: `${rf.path} defines API routes but the server never mounts it with app.use('/…', router) — its endpoints aren't reachable. Import and mount it in the server entry file.` });
      }
    }
  }

  // missing-import: a local import that resolves to nothing → the app is incoherent / won't load
  for (const f of code) {
    const specs = new Set<string>();
    for (const m of f.content.matchAll(/(?:\bfrom|\brequire\(|\bimport)\s*['"`](\.[^'"`]+)['"`]/g)) {
      if (!ASSET_RE.test(m[1]!)) specs.add(m[1]!);
    }
    for (const spec of specs) {
      if (!localImportExists(f.path, spec, allPaths)) {
        issues.push({ kind: "missing-import", where: f.path, message: `${f.path} imports "${spec}", which does not exist in the project — create the missing file or fix the path.` });
      }
    }
  }

  // build completeness: implemented feature layers (repos/services/controllers) the API never serves
  issues.push(...checkUnexposedFeatures(files, allPaths));

  // cross-consumer: does the frontend actually call the backend's routes?
  issues.push(...checkFrontendBackendContract(files));

  // de-dupe by message
  const seen = new Set<string>();
  return issues.filter((i) => (seen.has(i.message) ? false : (seen.add(i.message), true)));
}

/**
 * Repair order. A build with no server entry point produces a cascade: the missing entry (tier 0) is
 * WHY the routers are unmounted (tier 2) — you cannot mount a router in a file that doesn't exist. So
 * fix foundational issues first and in isolation; downstream ones often vanish once the entry exists.
 * Feeding all of them to the coder at once buries the one fix that matters.
 */
export const RUNNABLE_TIER: Record<RunnableIssue["kind"], number> = {
  "no-entry": 0,
  "broken-start": 0,
  "unrunnable-entry": 0, // the start command cannot execute its own entry — nothing else matters
  "missing-import": 1,
  "missing-env": 1,
  "unmounted-routes": 2,
  "unexposed-feature": 2, // same family as unmounted-routes: implemented code the API never serves
  "frontend-backend-mismatch": 3,
  "missing-endpoint": 3, // the base is right; specific routes are absent (mutually exclusive with ↑)
};

/** Group issues into repair tiers, most-foundational first (each inner array is one tier). */
export function tiersOf(issues: RunnableIssue[]): RunnableIssue[][] {
  const byTier = new Map<number, RunnableIssue[]>();
  for (const i of issues) {
    const t = RUNNABLE_TIER[i.kind];
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t)!.push(i);
  }
  return [...byTier.keys()].sort((a, b) => a - b).map((t) => byTier.get(t)!);
}

/**
 * A file that is SUPPOSED to be the entry but is only a placeholder — comments/TODOs, no real code,
 * no `.listen(`. The coder often scaffolds `// implementation will follow` during the build and never
 * returns; the repair must be told to REPLACE it, not "create" a new one.
 */
export function findStubEntry(files: SourceFile[]): string | null {
  for (const f of files) {
    if (!isCode(f.path) || !/\/(index|server|app|main)\.(js|ts|mjs|cjs)$/.test("/" + norm(f.path))) continue;
    if (/\.listen\s*\(/.test(f.content)) continue; // a real entry
    const bare = f.content.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");
    if (bare.length < 40 || /placeholder|willfollow|tobeimplemented|comingsoon|todo/i.test(f.content.replace(/\s+/g, ""))) return f.path;
  }
  return null;
}

/**
 * When the foundational problem is a missing/wrong server entry, hand the coder a single concrete
 * directive — including the exact routers to mount — so it writes ONE coherent entry file rather than
 * flailing at seven symptoms. This is the fix that unblocks everything downstream.
 */
export function foundationalDirective(issues: RunnableIssue[], files: SourceFile[] = []): string {
  const routers = issues.filter((i) => i.kind === "unmounted-routes" && i.where).map((i) => i.where!);
  const where = issues.find((i) => i.kind === "no-entry")?.where ?? issues.find((i) => i.kind === "broken-start")?.where ?? ".";
  const stub = findStubEntry(files);
  const action = stub
    ? `The file "${stub}" already exists but is an EMPTY PLACEHOLDER — REPLACE its entire contents with a real server entry that:`
    : `Create ONE real server entry file in the SAME place the backend code actually lives (near ${where} — do not invent a new folder like src/ if the code is in backend/). That file must:`;
  return (
    `${action} import the web framework, apply the middleware, import and MOUNT EVERY router with app.use('/api/...', router)` +
    (routers.length ? ` — the routers you must mount are: ${routers.join(", ")}` : "") +
    `, read the port from process.env.PORT, and call app.listen. Then set package.json "main" and the "start"/"dev" scripts to that exact file path. Write the file(s) now with the write tool — do not defer to a later step.`
  );
}

/**
 * Directive for dangling local imports (a file imports a module that doesn't exist). The coder keeps
 * either importing a module it never created (e.g. `../utils/errors.js`) or importing the wrong
 * extension (`.js` when the file is `.ts`). For each miss, find a near-match already in the project and
 * tell the coder to point at it — else create the module. Concrete beats "fix the path".
 */
export function missingImportDirective(issues: RunnableIssue[], files: SourceFile[]): string {
  const misses = issues.filter((i) => i.kind === "missing-import");
  if (misses.length === 0) return "";
  // A flagged import has no file at its exact path (any extension) — so the only useful hint is a file
  // of the SAME basename living elsewhere (a misplaced/renamed module). Otherwise it must be created.
  const byBase = new Map<string, string>();
  for (const f of files) byBase.set(moduleKey(f.path).split("/").pop() ?? "", f.path);
  const lines: string[] = [];
  for (const i of misses) {
    const spec = i.message.match(/imports "([^"]+)"/)?.[1];
    const from = i.where;
    if (!spec || !from) continue;
    const near = byBase.get(resolveTail(from, spec).split("/").pop() ?? "");
    lines.push(
      near
        ? `- ${from} imports "${spec}" (no such file). A module named the same exists at "${near}" — if that is the one you meant, fix the import to point there; otherwise create the missing module.`
        : `- ${from} imports "${spec}", which was never created — CREATE that module at the resolved path with the exact exports this file uses. Never import a file that does not exist.`,
    );
  }
  return "These imports resolve to nothing, so the app crashes the moment it loads. Fix EACH — point the import at the real file, or create the missing module:\n" + lines.join("\n") + "\nWrite the corrected/created file(s) now with the write tool.";
}

// ── unexposed features (build completeness) ───────────────────────────────────

const SERVER_FRAMEWORK_DEPS = ["express", "fastify", "koa", "@hapi/hapi", "@nestjs/core", "hapi"];
const TESTISH_RE = /(^|\/)(test|tests|__tests__)\/|\.(test|spec|e2e)\./i;
const FEATURE_PATH_RE = /(^|\/)(repositories|repos|controllers|services)\//i;
const FEATURE_NAME_RE = /\.(repo|repository|controller|service)s?\.[a-z]+$/i;
/** Conventional browser-served dirs — code here is fetched over HTTP, never imported by the server. */
const STATIC_FRONTEND_RE = /(^|\/)(public|static|www|assets|client|frontend|web|ui|dist|build)\//i;

export interface DeadFeatureReport {
  unit: string;
  /** Feature modules nothing reachable from the server entry imports — dead code. */
  dead: { path: string; exports: string[] }[];
  /** How many feature modules ARE reachable (0 ⇒ the import graph itself is suspect). */
  reachableFeatures: number;
  /** Import edges the walk successfully resolved — 0 means the graph never worked at all. */
  edgesResolved: number;
  /** A reachable file loads routes dynamically (readdir + import, or a non-literal import/require). */
  dynamicLoading: boolean;
}

/** Directory-scan or non-literal import/require — routes may be loaded at runtime, so the graph is blind. */
const DYNAMIC_LOAD_RE = /\b(?:readdirSync|readdir|globSync)\b|\bglob\s*\(|\b(?:require|import)\s*\(\s*[^'"`)\s]/;

/** Name a dead module's exports for the directive — ESM declarations, export lists, and CJS. */
function exportedNames(content: string): string[] {
  const names = new Set<string>();
  for (const m of content.matchAll(/export\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function\*?|const|let|var)\s+(\w+)/g)) names.add(m[1]!);
  for (const m of content.matchAll(/export\s*\{\s*([^}]+)\}/g)) for (const part of m[1]!.split(",")) { const n = part.split(/\s+as\s+/i)[0]!.trim(); if (/^\w+$/.test(n)) names.add(n); }
  for (const m of content.matchAll(/module\.exports\s*=\s*(?:new\s+)?(\w+)/g)) if (m[1] !== "module") names.add(m[1]!);
  for (const m of content.matchAll(/(?:module\.)?exports\.(\w+)\s*=/g)) names.add(m[1]!);
  return [...names].slice(0, 4);
}

/**
 * Build completeness (the BookIt gap): a build can pass every other gate — it boots, its mounted
 * routes work — while whole implemented features (an auth repo, a bookings service) are dead code,
 * because no route file was ever written to expose them. `unmounted-routes` can't see this: there is
 * no router file to flag. So walk the import graph from the server entry (the file that calls
 * `.listen()`); any repository/service/controller module nothing reachable imports is a feature the
 * API never serves. Scoped per backend unit, with files owned by a nested unit (e.g. the frontend's
 * own package.json) excluded — a frontend `src/services/` must never be judged by backend rules.
 */
export function deadFeatures(files: SourceFile[], allPaths: Set<string>): DeadFeatureReport[] {
  const code = files.filter((f) => isCode(f.path));
  const byPath = new Map(code.map((f) => [norm(f.path), f]));
  const units: { dir: string; server: boolean; pkg: Pkg }[] = [];
  for (const pkgFile of files.filter((f) => norm(f.path).endsWith("package.json"))) {
    try {
      const pkg = JSON.parse(pkgFile.content) as Pkg;
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      units.push({ dir: dirOf(pkgFile.path), server: SERVER_FRAMEWORK_DEPS.some((d) => d in deps), pkg });
    } catch {
      units.push({ dir: dirOf(pkgFile.path), server: false, pkg: {} });
    }
  }
  // The unit that owns a file is the DEEPEST package.json above it — so client/src/services/* belongs
  // to the client unit, not to a backend unit at the project root.
  const ownerOf = (p: string): string | null => {
    let best: string | null = null;
    for (const u of units) {
      const pref = u.dir ? u.dir + "/" : "";
      if (norm(p).startsWith(pref) && (best === null || u.dir.length > best.length)) best = u.dir;
    }
    return best;
  };

  const reports: DeadFeatureReport[] = [];
  for (const u of units.filter((x) => x.server)) {
    const prefix = u.dir ? u.dir + "/" : "";
    const unitCode = code.filter((f) => norm(f.path).startsWith(prefix) && ownerOf(f.path) === u.dir);

    // Path-alias imports (@/x, ~/x, #x) resolve through config the walker can't see — any conclusion
    // drawn from a graph with invisible edges would be wrong, so the whole unit is inconclusive.
    if (unitCode.some((f) => hasAliasImports(f.content))) continue;

    // Roots: every way this unit's code actually gets executed — the server entry (`.listen`), plus
    // any file a package.json script or `main` points at (workers, seeds, cron runners are real usage;
    // a service wired only to a worker entry is NOT dead). Test files are never roots: a spun-up
    // `app.listen` inside an e2e test would mark everything it imports "exposed" and mask the gap.
    const rootPaths = new Set<string>(unitCode.filter((f) => /\.listen\s*\(/.test(f.content) && !TESTISH_RE.test(norm(f.path))).map((f) => norm(f.path)));
    const scriptTargets: string[] = [...Object.values(u.pkg.scripts ?? {}), ...(u.pkg.main ? [`node ${u.pkg.main}`] : [])];
    for (const cmd of scriptTargets) {
      const m = String(cmd).match(/\b(?:node|nodemon|tsx|ts-node)\s+(?:--\S+\s+)*([^\s&|;]+)/);
      if (!m || !/[./]/.test(m[1]!)) continue;
      const resolved = resolveLocalImport(prefix + "package.json", "./" + m[1]!.replace(/^\.\//, ""), allPaths);
      if (resolved && byPath.has(norm(resolved)) && !TESTISH_RE.test(norm(resolved))) rootPaths.add(norm(resolved));
    }
    if (rootPaths.size === 0) continue; // nothing boots — the no-entry check owns that failure

    const reachable = new Set<string>();
    let edgesResolved = 0;
    const queue = [...rootPaths];
    while (queue.length > 0) {
      const p = queue.pop()!;
      if (reachable.has(p)) continue;
      reachable.add(p);
      const f = byPath.get(p);
      if (!f) continue;
      for (const spec of localSpecs(f.content)) {
        const target = resolveLocalImport(f.path, spec, allPaths);
        if (!target) continue;
        edgesResolved++;
        if (!reachable.has(norm(target))) queue.push(norm(target));
      }
    }

    const candidates = unitCode.filter(
      (f) =>
        (FEATURE_PATH_RE.test("/" + norm(f.path)) || FEATURE_NAME_RE.test(norm(f.path))) &&
        !TESTISH_RE.test(norm(f.path)) &&
        !STATIC_FRONTEND_RE.test("/" + norm(f.path).slice(prefix.length)) && // browser-served, not imported
        !/\.d\.tsx?$/.test(norm(f.path)), // a type declaration is not a feature
    );
    const dead = candidates.filter((f) => !reachable.has(norm(f.path)));
    if (dead.length === 0) continue;
    const dynamicLoading = [...reachable].some((p) => DYNAMIC_LOAD_RE.test(byPath.get(p)?.content ?? ""));
    reports.push({
      unit: u.dir || ".",
      reachableFeatures: candidates.length - dead.length,
      edgesResolved,
      dynamicLoading,
      dead: dead.map((f) => ({ path: f.path, exports: exportedNames(f.content) })),
    });
  }
  return reports;
}

/**
 * Is a report trustworthy enough to act on? Suppress when routes may be loaded dynamically (the static
 * graph can't see those edges) or when the walk resolved no edges at all (a broken/empty graph). If the
 * walk demonstrably traversed a working graph, an all-dead feature layer is a real, actionable gap.
 */
export function conclusiveDeadFeatures(r: DeadFeatureReport): boolean {
  if (r.dynamicLoading) return false; // routes may be auto-loaded at runtime — the static graph is blind
  return r.reachableFeatures > 0 || r.edgesResolved > 0; // the walk actually traversed a working graph
}

function checkUnexposedFeatures(files: SourceFile[], allPaths: Set<string>): RunnableIssue[] {
  const issues: RunnableIssue[] = [];
  for (const r of deadFeatures(files, allPaths)) {
    // Sanity guard: an inconclusive import graph must not condemn the feature layer.
    if (!conclusiveDeadFeatures(r)) continue;
    issues.push({
      kind: "unexposed-feature",
      where: r.unit,
      message: `${r.unit}: feature modules are implemented but never exposed — nothing reachable from the server entry imports ${r.dead.map((d) => d.path).join(", ")}. Those features are dead code: the API never serves them. Create the missing route(s) that use them and mount them in the server entry.`,
    });
  }
  return issues;
}

/**
 * Directive for dead feature modules. "Wire them up" is not enough — name each dead module, what it
 * exports, and exactly where the wiring goes; and if the frontend already calls paths for these
 * features, mount the new routes so those paths resolve.
 */
/** A route file is defined by CONTENT — it builds and exports a router — not by where it lives. A
 *  modular layout (modules/<feature>/routes.ts) has no routes/ dir, so a path rule misses it. */
function isRouterFile(f: SourceFile): boolean {
  return isCode(f.path) && exportsRouter(f.content);
}

/** The feature name for a module/route file — its basename, or the parent folder when the basename is
 *  generic (routes/index/router), so a modular `modules/auth/routes.ts` reads as "auth", not "routes". */
function featureName(path: string): string {
  const parts = norm(path).split("/");
  let base = (parts.pop() ?? "").replace(/\.\w+$/, "").replace(/\.(routes?|router|service|repo|repository|controller)s?$/i, "");
  if (/^(routes?|router|index)$/i.test(base) || base === "") base = (parts.pop() ?? base).replace(/\.(routes?|router|service|repo|repository|controller)s?$/i, "");
  return base || "feature";
}

/** The file where routers are mounted (creates the framework app and calls `.use`), if any. */
function mountFile(files: SourceFile[], unit: string): SourceFile | undefined {
  const prefix = unit && unit !== "." ? unit + "/" : "";
  const unitCode = files.filter((f) => isCode(f.path) && norm(f.path).startsWith(prefix));
  return (
    unitCode.find((f) => /\b(express|fastify|koa)\(\)|createServer\s*\(/.test(f.content) && /\.use\s*\(/.test(f.content)) ??
    unitCode.find((f) => /\bapp\.use\s*\(/.test(f.content))
  );
}

export function unexposedFeatureDirective(files: SourceFile[]): string {
  const paths = new Set(files.map((f) => norm(f.path)));
  const reports = deadFeatures(files, paths).filter(conclusiveDeadFeatures);
  if (reports.length === 0) return "";
  const d = analyzeContract(files);
  const wanted = d ? [...d.frontendCalls].filter((c) => !d.backendPaths.has(c)).slice(0, 6) : [];

  const blocks = reports.map((r) => {
    const deadSet = new Set(r.dead.map((m) => norm(m.path)));
    const app = mountFile(files, r.unit);
    const appImports = app ? new Set(localSpecs(app.content).map((s) => resolveLocalImport(app.path, s, paths)).filter(Boolean).map((p) => norm(p!))) : new Set<string>();
    // Route files that ALREADY exist and reach a dead module, but the app file never imports them —
    // these just need MOUNTING (the coder keeps writing routes and forgetting to wire them in).
    const routeFiles = files.filter((f) => isRouterFile(f) && norm(f.path).startsWith((r.unit === "." ? "" : r.unit + "/")));
    const unmounted = routeFiles.filter((rf) => !appImports.has(norm(rf.path)) && localSpecs(rf.content).some((s) => deadSet.has(norm(resolveLocalImport(rf.path, s, paths) ?? ""))));
    const lines = r.dead.map((m) => `  - ${m.path}${m.exports.length ? ` (exports: ${m.exports.join(", ")})` : ""}`).join("\n");
    const mountLine = app
      ? `The app file that mounts routers is "${app.path}". You MUST edit it: add an \`import\` and an \`app.use('/api/<feature>', <router>)\` for each router.`
      : `Mount every router in the server entry file with \`app.use('/api/<feature>', router)\`.`;
    const already = unmounted.length ? ` These route files ALREADY EXIST and only need mounting — do NOT rewrite them, just import and app.use each in the app file: ${unmounted.map((f) => f.path).join(", ")}.` : "";
    return `Unit ${r.unit} — dead feature modules (imported by nothing reachable from the entry):\n${lines}\n${mountLine}${already}`;
  });

  return (
    `The backend implements features its API never serves — these modules are dead code (nothing reachable from the server entry imports them):\n\n${blocks.join("\n\n")}\n\n` +
    `For EACH dead module that has no route yet: create the matching route file (add a controller if this codebase uses controllers) with real REST endpoints backed by the module's exports, then import and mount it in the app file above. For modules whose route file already exists, just wire it into the app file.` +
    (wanted.length ? ` The frontend already calls ${wanted.join(", ")} — mount so those exact paths resolve.` : "") +
    ` The job is not done until the app file imports and mounts a router for every module listed. Write the new and updated files now with the write tool.`
  );
}

/**
 * Directive for routes the frontend needs but the backend never defined. The base URL is already
 * correct, so this is not an alignment problem — a handler is genuinely missing. Name the exact gaps
 * and what already exists, and steer the fix to the BACKEND (the frontend is expressing the spec).
 */
export function missingEndpointDirective(files: SourceFile[]): string {
  const d = analyzeContract(files);
  if (!d) return "";
  const missing = missingEndpoints(d);
  if (missing.length === 0) return "";
  return (
    `The frontend and backend agree on the base URL, but the frontend calls endpoints the backend never defines — those requests 404 at runtime and no boot check can catch it (the server starts fine).\n` +
    `Missing (the frontend needs these): ${missing.join(", ")}.\n` +
    `Backend currently serves: ${d.backendEndpoints.slice(0, 12).join("; ")}.\n` +
    `ADD the missing route(s) on the backend: implement the handler in the matching router/controller and mount it so the path resolves exactly as the frontend calls it. Only change the frontend instead if one of its calls is genuinely wrong. Write the file(s) now with the write tool.`
  );
}

/** Directive for a start command that cannot execute its own entry (JS/TS mixed with no runner). */
export function unrunnableEntryDirective(issues: RunnableIssue[]): string {
  const i = issues.find((x) => x.kind === "unrunnable-entry");
  if (!i) return "";
  return (
    `This unit cannot start at all: its start script runs plain node, but the code it loads is TypeScript. Pick ONE coherent approach and make the start command able to run the entry:\n` +
    `- simplest: write this unit in plain JavaScript (.js) and import .js files only; or\n` +
    `- keep TypeScript and add a real build: a "build" script (tsc) plus "start": "node dist/index.js"; or\n` +
    `- keep TypeScript and run it through a loader: "start": "tsx src/index.ts" (add tsx as a dependency).\n` +
    `Do not leave a project whose start command cannot execute its own entry point. Write the corrected file(s)/package.json now.`
  );
}

/** The right focused directive for a repair tier, plus a short note for the log. */
export function directiveFor(tier: RunnableIssue[], allIssues: RunnableIssue[], files: SourceFile[]): { text: string; note: string } {
  const has = (k: RunnableIssue["kind"]): boolean => tier.some((i) => i.kind === k);
  if (has("no-entry") || has("broken-start")) return { text: foundationalDirective(allIssues, files), note: " (create the server entry that mounts every router)" };
  if (has("unrunnable-entry")) return { text: unrunnableEntryDirective(tier), note: " (make the start command able to run its own entry)" };
  if (has("missing-import")) return { text: missingImportDirective(tier, files), note: " (point each dangling import at the real file or create it)" };
  if (has("unexposed-feature")) return { text: unexposedFeatureDirective(files), note: " (expose the implemented features through mounted routes)" };
  if (has("frontend-backend-mismatch")) return { text: contractDirective(files), note: " (align the frontend API client to the backend's real routes)" };
  if (has("missing-endpoint")) return { text: missingEndpointDirective(files), note: " (add the routes the frontend needs)" };
  return { text: "", note: "" };
}

// ── deterministic wire-up (mount existing routers without a model call) ────────

export interface WireUpEdit {
  /** The app/entry file that was edited. */
  path: string;
  /** Its new content, with imports + app.use lines added. */
  content: string;
  mounted: { router: string; varName: string }[];
}

/** A file that exports an Express-style router (built with Router()/express.Router()). */
function exportsRouter(content: string): boolean {
  if (!/\b(?:express\.)?Router\s*\(/.test(content)) return false;
  return /export\s+default\b/.test(content) || /module\.exports\s*=/.test(content) || /export\s*\{\s*router\b/.test(content);
}

/** A stable JS identifier for a route file: auth.routes.ts (or modules/auth/routes.ts) → authRoutes. */
function routerVarName(path: string, taken: Set<string>): string {
  let name = featureName(path).replace(/[^a-zA-Z0-9]+([a-zA-Z0-9])?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ""));
  if (!/^[a-zA-Z_]/.test(name)) name = "r" + name;
  name = name + "Routes";
  let out = name;
  for (let n = 2; taken.has(out); n++) out = name + n;
  taken.add(out);
  return out;
}

/** Relative import spec from the app file to a target, mirroring the app's extension + quote style. */
function relImport(appPath: string, targetPath: string, appContent: string): { spec: string; quote: string } {
  const from = norm(appPath).split("/").slice(0, -1);
  const to = norm(targetPath).split("/");
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  let rel = [...from.slice(i).map(() => ".."), ...to.slice(i)].join("/");
  if (!/^\.\.?\//.test(rel)) rel = "./" + rel;
  // Mirror the extension the app WRITES in its relative import specifiers, not the target's real one:
  // TS-ESM apps write `.js` specifiers that point at `.ts` files (a `.ts` specifier breaks under tsc).
  const specExt = appContent.match(/from\s+['"]\.[^'"]*?(\.[a-z]+)['"]/)?.[1]?.toLowerCase();
  if (specExt && /^\.(js|jsx|mjs|cjs)$/.test(specExt)) rel = rel.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, ".js");
  else if (specExt && /^\.(ts|tsx)$/.test(specExt)) rel = rel.replace(/\.(js|jsx|mjs|cjs)$/, ".ts");
  else if (!specExt) rel = rel.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, ""); // app writes extensionless specifiers
  const quote = appContent.match(/import\s+[\w{},*\s]+from\s+(['"])/)?.[1] ?? "'";
  return { spec: rel, quote };
}

/** Insert `import`/`app.use` lines into an app file — after the import block, before terminal middleware. */
function applyMounts(content: string, appVar: string, importLines: string[], useLines: string[]): string {
  const nl = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\b/.test(lines[i]!) || /^\s*(?:const|let|var)\s+[^=]*=\s*require\s*\(/.test(lines[i]!)) lastImport = i;
    else if (lastImport >= 0 && lines[i]!.trim() !== "" && !/^\s*\/\//.test(lines[i]!)) break;
  }
  // Mount BEFORE the first terminal middleware (a 404 catch-all or the error handler), else after the
  // last existing `<app>.use(` line — so routes are always reachable ahead of the catch-all.
  const useRe = new RegExp(`\\b${appVar}\\.use\\s*\\(`);
  const termRe = new RegExp(`\\b${appVar}\\.use\\s*\\(\\s*(?:\\(|async\\b|function\\b|\\w*[Ee]rror\\w*|\\w*not[Ff]ound\\w*|handle404)`);
  let mountIdx = lines.findIndex((l) => termRe.test(l));
  if (mountIdx === -1) {
    let lastUse = -1;
    for (let i = 0; i < lines.length; i++) if (useRe.test(lines[i]!)) lastUse = i;
    mountIdx = lastUse >= 0 ? lastUse + 1 : Math.max(0, lines.findIndex((l) => new RegExp(`\\b${appVar}\\s*=\\s*(?:express|fastify|koa)\\s*\\(`).test(l)) + 1) || lines.length;
  }
  lines.splice(mountIdx, 0, ...useLines); // insert body first — keeps the import index valid
  lines.splice(lastImport + 1, 0, ...importLines);
  return lines.join(nl);
}

/**
 * Deterministic wire-up: mount every router file the app doesn't already import. Writing a route file
 * and forgetting to wire it into the app is the failure the coder repeats even when told exactly what
 * to do (it's a coordinated multi-file edit) — but mounting an existing router is purely mechanical, so
 * a transform does it reliably and the model is left only with genuinely-missing routes to *generate*.
 */
export function planWireUp(files: SourceFile[], allPaths: Set<string>): WireUpEdit[] {
  const code = files.filter((f) => isCode(f.path));
  const byPath = new Map(code.map((f) => [norm(f.path), f]));
  const serverDirs = files
    .filter((f) => norm(f.path).endsWith("package.json"))
    .flatMap((f) => {
      try {
        const pkg = JSON.parse(f.content) as Pkg;
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        return SERVER_FRAMEWORK_DEPS.some((d) => d in deps) ? [dirOf(f.path)] : [];
      } catch {
        return [];
      }
    });

  const edits: WireUpEdit[] = [];
  for (const dir of serverDirs) {
    const prefix = dir && dir !== "." ? dir + "/" : "";
    const app = mountFile(files, dir);
    if (!app) continue;

    // Reachable from the app file — a router transitively mounted via a barrel/index counts as wired.
    const reachable = new Set<string>([norm(app.path)]);
    const queue = [norm(app.path)];
    while (queue.length) {
      const f = byPath.get(queue.pop()!);
      if (!f) continue;
      for (const spec of localSpecs(f.content)) {
        const t = resolveLocalImport(f.path, spec, allPaths);
        if (t && !reachable.has(norm(t))) {
          reachable.add(norm(t));
          queue.push(norm(t));
        }
      }
    }

    const routers = code.filter((f) => norm(f.path).startsWith(prefix) && isRouterFile(f) && !reachable.has(norm(f.path)) && norm(f.path) !== norm(app.path));
    if (routers.length === 0) continue;

    const taken = new Set<string>();
    for (const m of app.content.matchAll(/(?:import\s+|(?:const|let|var|function|class)\s+)(\w+)/g)) taken.add(m[1]!);
    const appVar = app.content.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:express|fastify|koa)\s*\(\s*\)/)?.[1] ?? "app";
    const prefixed = new RegExp(`\\b${appVar}\\.use\\s*\\(\\s*['"\`]/`).test(app.content); // existing mounts use a path prefix?

    const importLines: string[] = [];
    const useLines: string[] = [];
    const mounted: WireUpEdit["mounted"] = [];
    for (const rf of routers) {
      const v = routerVarName(rf.path, taken);
      const { spec, quote } = relImport(app.path, rf.path, app.content);
      const feature = featureName(rf.path);
      importLines.push(`import ${v} from ${quote}${spec}${quote};`);
      useLines.push(prefixed ? `${appVar}.use(${quote}/api/${feature}${quote}, ${v});` : `${appVar}.use(${v});`);
      mounted.push({ router: rf.path, varName: v });
    }
    edits.push({ path: app.path, content: applyMounts(app.content, appVar, importLines, useLines), mounted });
  }
  return edits;
}

// ── scaffold a route file from a template (for a dead module with no route) ────

export interface ScaffoldEdit {
  path: string;
  content: string;
  feature: string;
  module: string;
}

interface ModuleApi {
  className: string;
  isDefault: boolean;
  methods: { name: string; isStatic: boolean; params: string[] }[];
}

/** Parse a service/repo/controller module: its exported class and public methods. */
function parseModuleApi(content: string): ModuleApi | null {
  let m = content.match(/export\s+default\s+class\s+(\w+)/);
  let className: string | undefined;
  let isDefault = false;
  if (m) {
    className = m[1];
    isDefault = true;
  } else if ((m = content.match(/export\s+class\s+(\w+)/))) {
    className = m[1];
  } else if ((m = content.match(/\bclass\s+(\w+)/)) && new RegExp(`export\\s+default\\s+${m[1]}\\b|module\\.exports\\s*=\\s*${m[1]}\\b`).test(content)) {
    className = m[1];
    isDefault = true;
  } else if ((m = content.match(/module\.exports\s*=\s*(\w+)/))) {
    className = m[1];
    isDefault = true;
  }
  if (!className) return null;
  const methods: ModuleApi["methods"] = [];
  const seen = new Set<string>();
  const re = /(?:^|\n)[ \t]*(public\s+|private\s+|protected\s+)?(static\s+)?(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*[:{]/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(content))) {
    const [, vis, stat, name, rawParams] = mm;
    if (name === "constructor" || /^(if|for|while|switch|catch|return|function)$/.test(name!) || vis?.startsWith("private") || vis?.startsWith("protected") || seen.has(name!)) continue;
    seen.add(name!);
    const params = rawParams!
      .split(",")
      .map((p) => p.trim().replace(/\.\.\./, "").split(/[?:=]/)[0]!.trim())
      .filter((p) => /^\w+$/.test(p));
    methods.push({ name: name!, isStatic: !!stat, params });
  }
  return methods.length ? { className, isDefault, methods } : null;
}

/** Map a method name to an HTTP verb, path, and success status. */
function routeForMethod(name: string): { verb: "get" | "post" | "put" | "delete"; path: string; status: number } {
  const m = name.toLowerCase();
  if (/^(create|add|insert|register|book|new|make|save|submit|login|signup)/.test(m)) return { verb: "post", path: "/", status: 201 };
  if (/^(update|edit|modify|patch|change|set)/.test(m)) return { verb: "put", path: "/:id", status: 200 };
  if (/^(delete|remove|cancel|destroy|revoke)/.test(m)) return { verb: "delete", path: "/:id", status: 204 };
  if (/^(list|getall|findall|all|search|index|query|browse)/.test(m)) return { verb: "get", path: "/", status: 200 };
  if (/^(get|find|fetch|show|read|by|detail|load)/.test(m)) {
    // a plural / collection-shaped name (getCustomerBookings, findUsers) is a list → GET /; else GET /:id
    return /s$/.test(name) || /\b(all|list|many)\b/i.test(name) ? { verb: "get", path: "/", status: 200 } : { verb: "get", path: "/:id", status: 200 };
  }
  return { verb: "post", path: "/" + name, status: 200 };
}

/** Where each method pulls its argument from (path param, body, or query) — best-effort by name. */
function argExpr(param: string, verb: string, path: string): string {
  if (path.includes(":id") && /^id$|Id$/.test(param)) return "req.params.id";
  return verb === "get" || verb === "delete" ? `req.query.${param}` : `req.body.${param}`;
}

function renderRouteFile(api: ModuleApi, spec: string, quote: string): string {
  const q = (s: string): string => quote + s + quote;
  const importStmt = api.isDefault ? `import ${api.className} from ${q(spec)};` : `import { ${api.className} } from ${q(spec)};`;
  const needsInstance = api.methods.some((m) => !m.isStatic);
  const usedPaths = new Set<string>();
  const handlers = api.methods.slice(0, 8).map((mth) => {
    let { verb, path, status } = routeForMethod(mth.name);
    let key = `${verb} ${path}`;
    if (usedPaths.has(key)) {
      path = path.includes(":id") ? `/${mth.name}/:id` : `/${mth.name}`;
      key = `${verb} ${path}`;
    }
    usedPaths.add(key);
    const base = mth.isStatic ? api.className : "controller";
    const args = mth.params.map((p) => argExpr(p, verb, path)).join(", ");
    const send = status === 204 ? "res.status(204).end();" : `res.status(${status}).json(result ?? { ok: true });`;
    return (
      `// ${mth.name} — scaffolded; refine the argument mapping and status as needed\n` +
      `router.${verb}(${q(path)}, async (req, res, next) => {\n` +
      `  try {\n    const result = await ${base}.${mth.name}(${args});\n    ${send}\n  } catch (err) {\n    next(err);\n  }\n});`
    );
  });
  return (
    `import { Router } from ${quote}express${quote};\n${importStmt}\n\n` +
    `// Auto-scaffolded router exposing ${api.className}. Endpoints are a starting point — adjust paths,\n` +
    `// verbs, auth, and argument wiring to match the real contract.\n` +
    `const router = Router();\n${needsInstance ? `const controller = new ${api.className}();\n` : ""}\n` +
    handlers.join("\n\n") +
    `\n\nexport default router;\n`
  );
}

/**
 * Scaffold a route file for every dead feature module that has NO route at all — the piece the model
 * couldn't reliably generate. It writes a real router that imports the module and exposes its public
 * methods as REST endpoints (verb/path inferred from the method name, args mapped by parameter name).
 * Only "top-level" dead modules get a route: a repo imported by a dead service is exposed transitively
 * once the service's route exists, so it isn't given its own. The subsequent wire-up pass mounts them.
 */
export function scaffoldRoutes(files: SourceFile[], allPaths: Set<string>): ScaffoldEdit[] {
  const reports = deadFeatures(files, allPaths).filter(conclusiveDeadFeatures);
  if (reports.length === 0) return [];
  const code = files.filter((f) => isCode(f.path));
  const byPath = new Map(code.map((f) => [norm(f.path), f]));
  const routeFiles = code.filter(isRouterFile);
  const routerImports = new Set<string>();
  for (const rf of routeFiles) for (const s of localSpecs(rf.content)) { const t = resolveLocalImport(rf.path, s, allPaths); if (t) routerImports.add(norm(t)); }
  // Learn the import-extension convention from a file that actually has a relative import with an
  // extension (an empty router reveals nothing) — else the scaffold would strip a needed `.js`.
  const styleSample = code.map((f) => f.content).find((c) => /from\s+['"]\.[^'"]*\.(?:ts|tsx|js|jsx|mjs|cjs)['"]/.test(c) || /require\s*\(\s*['"]\.[^'"]*\.(?:ts|tsx|js|jsx|mjs|cjs)['"]/.test(c)) ?? "";

  const edits: ScaffoldEdit[] = [];
  const taken = new Set<string>([...allPaths].map(norm));
  for (const r of reports) {
    const deadPaths = new Set(r.dead.map((d) => norm(d.path)));
    // modules imported by another dead module are exposed transitively — don't give them their own route
    const importedByDead = new Set<string>();
    for (const d of r.dead) { const f = byPath.get(norm(d.path)); if (f) for (const s of localSpecs(f.content)) { const t = resolveLocalImport(f.path, s, allPaths); if (t && deadPaths.has(norm(t))) importedByDead.add(norm(t)); } }
    const routeDir = routeFiles.find((f) => norm(f.path).startsWith((r.unit === "." ? "" : r.unit + "/")))?.path.replace(/\/[^/]+$/, "") ?? null;

    for (const d of r.dead) {
      if (importedByDead.has(norm(d.path)) || routerImports.has(norm(d.path))) continue;
      const mod = byPath.get(norm(d.path));
      if (!mod) continue;
      const api = parseModuleApi(mod.content);
      if (!api) continue; // not a parseable class → leave to the model
      const feature = featureName(d.path);
      const dir = routeDir ?? norm(d.path).replace(/\/[^/]+$/, "").replace(/\/(repositories|repos|services|controllers)$/i, "/routes");
      const ext = /\.tsx?$/.test(mod.path) ? "ts" : "js";
      const routePath = `${dir}/${feature}.routes.${ext}`;
      if (taken.has(norm(routePath))) continue;
      const { spec, quote } = relImport(routePath, mod.path, styleSample);
      edits.push({ path: routePath, content: renderRouteFile(api, spec, quote), feature, module: mod.path });
      taken.add(norm(routePath));
    }
  }
  return edits;
}

/** Turn runnability issues into a repair instruction. */
export function runnableFeedback(issues: RunnableIssue[]): string {
  if (issues.length === 0) return "";
  return (
    "The built project is not runnable yet. Fix each of these by creating or editing the necessary files (use the write tool):\n" +
    issues.map((i) => `- ${i.message}`).join("\n") +
    "\nWrite the missing/fixed files now so the app actually runs end to end."
  );
}

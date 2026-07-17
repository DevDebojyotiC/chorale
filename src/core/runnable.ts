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
  kind: "no-entry" | "broken-start" | "unrunnable-entry" | "missing-import" | "missing-env" | "unmounted-routes" | "frontend-backend-mismatch" | "missing-endpoint";
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
  const backendPaths = new Set(backendEndpoints.map((e) => pathOnly(e.replace(/^\w+\s+/, ""))));
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
const moduleKey = (p: string): string => norm(p).replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "").replace(/\/index$/, "");

/** Resolve an import specifier against the importing file's dir, to a comparable module tail. */
function resolveTail(fromPath: string, spec: string): string {
  const dir = moduleKey(fromPath).split("/").slice(0, -1);
  for (const seg of norm(spec).replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "").split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") dir.pop();
    else dir.push(seg);
  }
  return dir.join("/").replace(/\/index$/, "");
}
/** Suffixes tried when resolving a module path (bare, extensions, index files). */
const RESOLVE_SUFFIXES = ["", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", "/index.js", "/index.ts", "/index.jsx", "/index.tsx"];
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
  const target = parts.join("/").replace(/\.(js|ts|jsx|tsx|mjs|cjs)$/, "");
  for (const s of RESOLVE_SUFFIXES) if (allPaths.has(target + s)) return target + s;
  return null;
}

/** Resolve a relative import against the importing file, testing whether the target file exists. */
function localImportExists(fromPath: string, spec: string, allPaths: Set<string>): boolean {
  return resolveLocalImport(fromPath, spec, allPaths) !== null;
}

/** Every local (relative) import specifier in a file, excluding non-code assets. */
function localSpecs(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(/(?:\bfrom|\brequire\(|\bimport)\s*['"`](\.[^'"`]+)['"`]/g)) if (!ASSET_RE.test(m[1]!)) out.push(m[1]!);
  return out;
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

    // missing-env: code needs env vars but only .env.example exists (the login/JWT_SECRET gap)
    const needsSecret = unitCode.some((f) => /process\.env\.(JWT_SECRET|SECRET|SESSION_SECRET|DATABASE_URL|DB_URL)/.test(f.content));
    if (needsSecret && !allPaths.has(prefix + ".env")) {
      issues.push({ kind: "missing-env", where: dir || ".", message: `${dir || "project"}: reads required secrets from process.env (e.g. JWT_SECRET) but there is no .env file${allPaths.has(prefix + ".env.example") ? " (only .env.example)" : ""} — create a real .env so it runs, and mention it in the README.` });
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
  if (has("frontend-backend-mismatch")) return { text: contractDirective(files), note: " (align the frontend API client to the backend's real routes)" };
  if (has("missing-endpoint")) return { text: missingEndpointDirective(files), note: " (add the routes the frontend needs)" };
  return { text: "", note: "" };
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

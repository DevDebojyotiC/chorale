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
  kind: "no-entry" | "broken-start" | "missing-import" | "missing-env" | "unmounted-routes" | "frontend-backend-mismatch";
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
function checkFrontendBackendContract(files: SourceFile[]): RunnableIssue[] {
  const backendPaths = new Set(
    extractContract(files).endpoints
      .filter((e) => /^(GET|POST|PUT|PATCH|DELETE)\s/.test(e))
      .map((e) => pathOnly(e.replace(/^\w+\s+/, ""))),
  );
  if (backendPaths.size === 0) return [];
  const feFiles = files.filter((f) => isCode(f.path) && /\b(axios|fetch)\b/.test(f.content) && !/\bexpress\b|\.listen\s*\(/.test(f.content));
  if (feFiles.length === 0) return [];

  const basePaths = new Set<string>();
  for (const f of feFiles) for (const m of f.content.matchAll(/\b(?:API_BASE_URL|API_URL|BASE_URL|baseURL)\b\s*[:=]\s*['"`]([^'"`]+)['"`]/g)) basePaths.add(pathOnly(m[1]!));
  const bases = basePaths.size ? [...basePaths] : ["/"];

  const called = new Set<string>();
  const addCall = (u: string): void => {
    if (/^https?:\/\//i.test(u)) called.add(pathOnly(u));
    else for (const b of bases) called.add(pathOnly((b === "/" ? "" : b) + "/" + u.replace(/^\//, "")));
  };
  for (const f of feFiles) {
    for (const m of f.content.matchAll(/\b(?:axios|fetch|\w*[Cc]lient|api)\.(?:get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi)) addCall(m[1]!);
    for (const m of f.content.matchAll(/\bfetch\(\s*['"`]([^'"`]+)['"`]/g)) addCall(m[1]!);
  }
  if (called.size === 0) return [];

  const matched = [...called].some((c) => backendPaths.has(c));
  if (!matched) {
    return [
      {
        kind: "frontend-backend-mismatch",
        where: "frontend",
        message: `the frontend calls API paths (${[...called].slice(0, 4).join(", ")}) that match none of the backend's endpoints (${[...backendPaths].slice(0, 4).join(", ")}) — requests won't reach the server. Align the frontend's base URL and paths to the backend's actual routes.`,
      },
    ];
  }
  return [];
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

/** Resolve a relative import against the importing file, testing whether the target file exists. */
function localImportExists(fromPath: string, spec: string, allPaths: Set<string>): boolean {
  const parts = norm(fromPath).split("/").slice(0, -1);
  for (const seg of norm(spec).split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  const target = parts.join("/").replace(/\.(js|ts|jsx|tsx|mjs|cjs)$/, "");
  return RESOLVE_SUFFIXES.some((s) => allPaths.has(target + s));
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

/** Turn runnability issues into a repair instruction. */
export function runnableFeedback(issues: RunnableIssue[]): string {
  if (issues.length === 0) return "";
  return (
    "The built project is not runnable yet. Fix each of these by creating or editing the necessary files (use the write tool):\n" +
    issues.map((i) => `- ${i.message}`).join("\n") +
    "\nWrite the missing/fixed files now so the app actually runs end to end."
  );
}

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

import type { SourceFile } from "./contract.js";

export interface RunnableIssue {
  kind: "no-entry" | "broken-start" | "missing-import" | "missing-env";
  where?: string;
  message: string;
}

const norm = (p: string): string => p.replace(/\\/g, "/");
const dirOf = (p: string): string => norm(p).split("/").slice(0, -1).join("/");
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

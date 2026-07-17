/**
 * Project-contract extraction (Phase 4 · fullstack lever #2).
 *
 * The fullstack experiment built a frontend that called `/api/auth/login` while the backend served
 * `/auth/login` — the frontend coder couldn't see the backend's *actual* routes, so it guessed. This
 * module reads the files built so far and extracts the concrete cross-cutting contract — HTTP
 * endpoints (mount prefix + route path composed), the base URL/port, DB tables, and exported symbols
 * — so later steps build against the real thing instead of a prose summary. Pure and deterministic
 * (no model calls); fully unit-testable.
 */

export interface ProjectContract {
  /** e.g. "http://localhost:3000" — the base the frontend must call. */
  baseUrl?: string;
  /** Composed endpoints, e.g. "POST /auth/login", "GET /notes". */
  endpoints: string[];
  /** DB tables, e.g. "users(id, email, password)". */
  tables: string[];
  /** Notable exported symbols (types/models/functions). */
  exports: string[];
}

export interface SourceFile {
  path: string;
  content: string;
}

/** Normalize a path to a comparable module key: forward slashes, no extension, no trailing /index. */
function moduleKey(p: string): string {
  return p.replace(/\\/g, "/").replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "").replace(/\/index$/, "");
}

/** Resolve an import specifier against the importing file's directory, to a comparable tail. */
function resolveTail(fromPath: string, spec: string): string {
  const dir = moduleKey(fromPath).split("/").slice(0, -1);
  const parts = spec.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "").split("/");
  for (const seg of parts) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") dir.pop();
    else dir.push(seg);
  }
  return dir.join("/").replace(/\/index$/, "");
}

function joinRoute(prefix: string, path: string): string {
  const p = (prefix + "/" + path).replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return p || "/";
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

/** Extract composed HTTP endpoints (mount prefix + route path) across the given files. */
function extractEndpoints(files: SourceFile[]): string[] {
  // route entries defined in each file (router.get('/x') / app.post('/y'))
  const routesByFile = new Map<string, { method: string; path: string }[]>();
  for (const f of files) {
    const entries = [...f.content.matchAll(/\b(?:router|app|route)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]*)['"`]/gi)].map((m) => ({
      method: m[1]!.toUpperCase(),
      path: m[2] || "/",
    }));
    if (entries.length) routesByFile.set(moduleKey(f.path), entries);
  }
  const findByTail = (tail: string): string | undefined => {
    for (const key of routesByFile.keys()) if (key === tail || key.endsWith("/" + tail) || tail.endsWith("/" + key)) return key;
    return undefined;
  };

  const out: string[] = [];
  const linked = new Set<string>();
  for (const f of files) {
    // var -> imported module tail (require + import)
    const imported = new Map<string, string>();
    for (const m of f.content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) imported.set(m[1]!, resolveTail(f.path, m[2]!));
    for (const m of f.content.matchAll(/import\s+(\w+)\s+from\s+['"`]([^'"`]+)['"`]/g)) imported.set(m[1]!, resolveTail(f.path, m[2]!));
    // app.use('/prefix', routerVar) → compose that router's routes under the prefix
    for (const m of f.content.matchAll(/\bapp\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)\s*\)/g)) {
      const prefix = m[1]!;
      const tail = imported.get(m[2]!);
      const key = tail ? findByTail(tail) : undefined;
      if (key) {
        linked.add(key);
        for (const e of routesByFile.get(key)!) out.push(`${e.method} ${joinRoute(prefix, e.path)}`);
      } else {
        out.push(`(router mounted at ${prefix})`);
      }
    }
    // direct app.METHOD('/path')
    for (const m of f.content.matchAll(/\bapp\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi)) out.push(`${m[1]!.toUpperCase()} ${m[2]}`);
  }
  // route files never linked to a mount → list raw so the info isn't lost
  for (const [key, entries] of routesByFile) if (!linked.has(key)) for (const e of entries) out.push(`${e.method} ${e.path}  (defined in ${key})`);
  return dedupe(out);
}

function extractTables(files: SourceFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    for (const m of f.content.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\)\s*;/gi)) {
      const name = m[1]!;
      const cols = m[2]!
        .split(",")
        .map((c) => c.trim().split(/\s+/)[0]!.replace(/["'`]/g, ""))
        .filter((c) => c && !/^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK)$/i.test(c));
      out.push(`${name}(${dedupe(cols).slice(0, 12).join(", ")})`);
    }
  }
  return dedupe(out);
}

function extractExports(files: SourceFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    for (const m of f.content.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/g)) out.push(m[1]!);
  }
  return dedupe(out).slice(0, 30);
}

/** Read the built files and extract the concrete project contract later steps must match. */
export function extractContract(files: SourceFile[]): ProjectContract {
  let port: string | undefined;
  for (const f of files) {
    const m =
      f.content.match(/\.listen\(\s*(?:process\.env\.\w+\s*(?:\|\|\s*)?)?(\d{2,5})/) ||
      f.content.match(/\bPORT\s*[:=]\s*(\d{2,5})/) ||
      f.content.match(/localhost:(\d{2,5})/);
    if (m) {
      port = m[1];
      break;
    }
  }
  return {
    baseUrl: port ? `http://localhost:${port}` : undefined,
    endpoints: extractEndpoints(files),
    tables: extractTables(files),
    exports: extractExports(files),
  };
}

/** Render the contract as a compact block to inject into a later step's task. */
export function formatContract(c: ProjectContract): string {
  const lines: string[] = [];
  if (c.baseUrl) lines.push(`- Backend base URL: ${c.baseUrl} — call this EXACT base; do NOT add an /api prefix unless an endpoint below has one.`);
  if (c.endpoints.length) lines.push("- API endpoints (use these EXACT method+path):\n" + c.endpoints.map((e) => `    ${e}`).join("\n"));
  if (c.tables.length) lines.push(`- DB tables: ${c.tables.join("; ")}`);
  if (c.exports.length) lines.push(`- Exported symbols available to import: ${c.exports.join(", ")}`);
  return lines.join("\n");
}

/** True when the contract carries anything worth injecting. */
export function hasContract(c: ProjectContract): boolean {
  return Boolean(c.baseUrl) || c.endpoints.length > 0 || c.tables.length > 0 || c.exports.length > 0;
}

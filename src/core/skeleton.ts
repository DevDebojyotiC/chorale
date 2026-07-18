/**
 * Deterministic project skeleton (Phase 4 · contract-first · lever #2).
 *
 * Contract-first only helps if the mechanical scaffolding the model routinely gets wrong or omits is
 * made correct WITHOUT a model call. The two worst offenders, from every real boot failure, are:
 *   · package.json that doesn't declare a package the code imports → `npm install` skips it → the app
 *     dies at load with "Cannot find package" (the OpsHub failure), and
 *   · a .env the model forgot, so a required env var is undefined at boot.
 *
 * This module reconciles both against the up-front contract AND the code that was actually written: it
 * ensures every declared+imported package lands in a package.json with a resolvable version range, and
 * every contract env var exists in a root .env. It is a pure planner — `planSkeleton` returns the exact
 * file writes needed (create or rewrite), touching nothing on disk — so it is fully unit-testable and
 * the runtime just applies the edits. Never deletes or narrows: it only completes what is missing.
 */

import type { SourceFile } from "./contract.js";
import type { DesignContract } from "./design-contract.js";
import { importedPackages } from "./runnable.js";
import { versionFor, isDevPackage } from "./dependency-registry.js";

export interface SkeletonEdit {
  path: string;
  content: string;
  /** Human-readable reason (for logging): what this write fixes. */
  reason: string;
}

const norm = (p: string): string => p.replace(/\\/g, "/");
const isCode = (p: string): boolean => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p);

/** Split a dependency spec into name + optional explicit range: "zod@^3" → {name:"zod", range:"^3"}. */
export function parseDep(spec: string): { name: string; range?: string } {
  const s = spec.trim();
  // scoped: @scope/name(@range)?  ·  bare: name(@range)?
  const at = s.lastIndexOf("@");
  if (s.startsWith("@")) {
    // find the SECOND @ (the version separator), if any
    const sep = s.indexOf("@", 1);
    return sep > 0 ? { name: s.slice(0, sep), range: s.slice(sep + 1) || undefined } : { name: s };
  }
  return at > 0 ? { name: s.slice(0, at), range: s.slice(at + 1) || undefined } : { name: s };
}

/** Parse a package.json's content leniently; returns null when malformed (a different problem). */
function parseManifest(content: string): Record<string, unknown> | null {
  try {
    const o = JSON.parse(content) as Record<string, unknown>;
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

/** The directory a path lives in ("" for a root-level file). */
const dirOf = (p: string): string => {
  const i = norm(p).lastIndexOf("/");
  return i < 0 ? "" : norm(p).slice(0, i);
};

/** True when `child` is at or below `dir` (both normalized, "" = root). */
const under = (child: string, dir: string): boolean => (dir === "" ? true : child === dir || child.startsWith(dir + "/"));

/**
 * Add every wanted package (name→range) to the manifest under the right key (dependencies or
 * devDependencies), skipping any already declared in ANY field. Returns the updated object and the
 * names actually added. Never changes an existing version. Deterministic key ordering for stable diffs.
 */
function addDeps(manifest: Record<string, unknown>, wanted: Map<string, string>, alreadyDeclared: Set<string>): { manifest: Record<string, unknown>; added: string[] } {
  const out = { ...manifest };
  const deps = { ...((out.dependencies as Record<string, string>) ?? {}) };
  const dev = { ...((out.devDependencies as Record<string, string>) ?? {}) };
  const added: string[] = [];
  for (const [name, range] of wanted) {
    if (alreadyDeclared.has(name) || name in deps || name in dev) continue;
    if (isDevPackage(name)) dev[name] = range;
    else deps[name] = range;
    added.push(name);
  }
  if (added.length === 0) return { manifest: out, added };
  if (Object.keys(deps).length) out.dependencies = sortKeys(deps);
  if (Object.keys(dev).length) out.devDependencies = sortKeys(dev);
  return { manifest: out, added };
}

const sortKeys = (o: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/** Ranges to use for a set of package names: an explicit contract range wins, else the curated pin. */
function rangesFor(names: Iterable<string>, explicit: Map<string, string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of names) m.set(n, explicit.get(n) ?? versionFor(n));
  return m;
}

/** Build a minimal, runnable package.json when the project has none. */
function freshManifest(dir: string, wanted: Map<string, string>, isTS: boolean): Record<string, unknown> {
  const deps: Record<string, string> = {};
  const dev: Record<string, string> = {};
  for (const [name, range] of wanted) (isDevPackage(name) ? dev : deps)[name] = range;
  if (isTS) {
    dev.tsx ??= versionFor("tsx");
    dev.typescript ??= versionFor("typescript");
    dev["@types/node"] ??= versionFor("@types/node");
  }
  const name = (dir.split("/").pop() || "app").toLowerCase().replace(/[^a-z0-9-]/g, "-") || "app";
  return {
    name,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: { start: isTS ? "tsx index.ts" : "node index.js" },
    ...(Object.keys(deps).length ? { dependencies: sortKeys(deps) } : {}),
    ...(Object.keys(dev).length ? { devDependencies: sortKeys(dev) } : {}),
  };
}

const ENV_HEADER = "# Environment variables — the app reads these at boot. Fill in real values before running.\n";

/** Reconcile a .env body so it defines every wanted var; existing lines/values are preserved. */
export function reconcileEnv(existing: string, vars: string[]): { content: string; added: string[] } {
  const present = new Set([...existing.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]!));
  const added = vars.filter((v) => v && !present.has(v));
  if (added.length === 0) return { content: existing, added: [] };
  const base = existing.trim() ? existing.replace(/\s*$/, "") + "\n" : ENV_HEADER;
  return { content: base + added.map((v) => `${v}=`).join("\n") + "\n", added };
}

/**
 * Compute the deterministic edits that make the project's package.json(s) and .env complete against the
 * contract and the code. Pure — returns writes; applies nothing. `existing` maps every project file's
 * (normalized) path to its content so we can rewrite manifests/.env in place.
 */
export function planSkeleton(files: SourceFile[], contract: DesignContract | undefined): SkeletonEdit[] {
  const edits: SkeletonEdit[] = [];
  const byPath = new Map(files.map((f) => [norm(f.path), f.content] as const));
  const manifestPaths = [...byPath.keys()].filter((p) => p.endsWith("package.json")).sort((a, b) => a.split("/").length - b.split("/").length);
  const isTS = files.some((f) => /\.tsx?$/.test(f.path));

  // Explicit ranges the contract pinned (e.g. "better-sqlite3@^12"), keyed by bare name.
  const explicit = new Map<string, string>();
  const contractDeps = new Set<string>();
  for (const spec of contract?.dependencies ?? []) {
    const { name, range } = parseDep(spec);
    if (!name) continue;
    contractDeps.add(name);
    if (range) explicit.set(name, range);
  }

  // ── package.json ──────────────────────────────────────────────────────────
  if (manifestPaths.length === 0) {
    // No manifest at all: create ONE at the shallowest common directory of the code, declaring every
    // package the code imports plus the contract's dependency list.
    const codeDirs = files.filter((f) => isCode(f.path)).map((f) => dirOf(f.path));
    const root = codeDirs.length ? codeDirs.reduce((a, b) => (a.split("/").length <= b.split("/").length ? a : b)) : "";
    const wantedNames = new Set<string>([...importedPackages(files), ...contractDeps]);
    if (wantedNames.size > 0 || isTS) {
      const wanted = rangesFor(wantedNames, explicit);
      const manifest = freshManifest(root, wanted, isTS);
      const path = root ? `${root}/package.json` : "package.json";
      edits.push({ path, content: JSON.stringify(manifest, null, 2) + "\n", reason: `created ${path} declaring ${wanted.size} dependenc${wanted.size === 1 ? "y" : "ies"}` });
    }
    return edits;
  }

  // Manifests exist: attribute each imported package to the DEEPEST manifest at/above the importing
  // file (the unit that owns it), then reconcile. Contract deps not imported anywhere → the root manifest.
  const depth = (dir: string): number => (dir === "" ? 0 : norm(dir).split("/").length);
  const manifestDirs = manifestPaths.map((p) => ({ path: p, dir: dirOf(p) }));
  const deepestFor = (fileDir: string): string => {
    let best: { path: string; dir: string } | undefined;
    for (const m of manifestDirs) if (under(fileDir, m.dir) && (!best || depth(m.dir) > depth(best.dir))) best = m;
    return (best ?? manifestDirs[0]!).path;
  };
  const ownedScan = new Map<string, SourceFile[]>();
  for (const f of files.filter((x) => isCode(x.path))) {
    const owner = deepestFor(dirOf(f.path));
    (ownedScan.get(owner) ?? ownedScan.set(owner, []).get(owner)!).push(f);
  }

  // Everything already declared anywhere (lenient, matches the missing-dependency check).
  const declaredAnywhere = new Set<string>();
  for (const mp of manifestPaths) {
    const m = parseManifest(byPath.get(mp)!);
    if (!m) continue;
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) for (const k of Object.keys((m[field] as object) ?? {})) declaredAnywhere.add(k);
    if (typeof m.name === "string") declaredAnywhere.add(m.name);
  }

  const rootManifest = manifestPaths[0]!;
  for (const mp of manifestPaths) {
    const raw = byPath.get(mp)!;
    const parsed = parseManifest(raw);
    if (!parsed) continue; // malformed — leave it for the model/other checks
    const scan = ownedScan.get(mp) ?? [];
    const names = new Set<string>(importedPackages(files, scan));
    if (mp === rootManifest) for (const d of contractDeps) if (!isImportedByOtherUnit(d, files, scan)) names.add(d);
    const wanted = rangesFor(names, explicit);
    const { manifest, added } = addDeps(parsed, wanted, declaredAnywhere);
    if (added.length > 0) {
      added.forEach((a) => declaredAnywhere.add(a)); // don't also add it to another manifest
      edits.push({ path: mp, content: JSON.stringify(manifest, null, 2) + "\n", reason: `${mp}: declared ${added.join(", ")}` });
    }
  }

  // ── .env ──────────────────────────────────────────────────────────────────
  const envVars = contract?.env ?? [];
  if (envVars.length > 0) {
    const rootDir = dirOf(rootManifest);
    const envPath = rootDir ? `${rootDir}/.env` : ".env";
    const existing = byPath.get(envPath) ?? "";
    const { content, added } = reconcileEnv(existing, envVars);
    if (added.length > 0) edits.push({ path: envPath, content, reason: `${envPath}: added env var${added.length === 1 ? "" : "s"} ${added.join(", ")}` });
  }

  return edits;
}

/** True when `pkg` is imported by some code file NOT in `scan` — so a contract dep already lands in another unit. */
function isImportedByOtherUnit(pkg: string, files: SourceFile[], scan: SourceFile[]): boolean {
  const scanSet = new Set(scan.map((f) => norm(f.path)));
  const others = files.filter((f) => isCode(f.path) && !scanSet.has(norm(f.path)));
  return others.length > 0 && importedPackages(files, others).has(pkg);
}

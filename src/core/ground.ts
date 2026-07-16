import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { resolveInside, SKIP_DIRS } from "../tools/permissions.js";

/**
 * Groundedness check (anti-hallucination) for doc-writing agents like the scribe.
 * Documentation fails when it references things that don't exist. We extract the
 * concrete claims a doc makes — file paths, code symbols, and npm scripts — and verify
 * each against the real workspace; anything missing is fed back for a fix. Plus a
 * meaning-preservation check for EDITS: technical facts present before an edit must
 * survive it. Conservative by design, so it rarely false-positives on illustrative text.
 */

export type RefKind = "path" | "symbol" | "script";

export interface MissingRef {
  file: string; // the doc that made the claim (workspace-relative)
  ref: string; // the referenced thing that doesn't exist
  kind: RefKind;
}

// Common globals/builtins that appear in docs but aren't project symbols — never flagged.
const BUILTIN_SYMBOLS = new Set([
  "require", "fetch", "console", "JSON", "Math", "Object", "Array", "Promise", "Date", "Map", "Set",
  "parseInt", "parseFloat", "isNaN", "setTimeout", "setInterval", "structuredClone", "Boolean", "Number",
  "String", "Symbol", "Error", "RegExp", "import", "export", "return", "await", "async", "function",
]);

/** Markdown relative links + backticked repo paths (slash + extension). */
export function extractPathRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/\]\(([^)\s]+)/g)) {
    const raw = (m[1] ?? "").trim().split(/[#?]/)[0]!;
    if (!raw || /^(https?:|mailto:|tel:|data:|\/\/|#)/i.test(raw)) continue;
    refs.add(raw);
  }
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    const t = (m[1] ?? "").trim();
    if (/^[\w.@-]+(\/[\w.@-]+)+$/.test(t) && /\.[a-z0-9]{1,6}$/i.test(t) && !/^https?:/i.test(t)) refs.add(t);
  }
  return [...refs];
}

/** Backticked call-syntax identifiers, e.g. `greet()` — a strong "this function exists" claim. */
export function extractSymbolRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/`([A-Za-z_$][\w$]*)\s*\(\s*[^`]*\)`/g)) {
    const id = m[1]!;
    if (!BUILTIN_SYMBOLS.has(id) && id.length >= 3) refs.add(id);
  }
  return [...refs];
}

/** `npm run <script>` (and pnpm/yarn) references — the script must exist in package.json. */
export function extractScriptRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/\b(?:npm run|pnpm run|pnpm|yarn)\s+([a-zA-Z][\w:-]*)/g)) refs.add(m[1]!);
  return [...refs];
}

function readSafe(abs: string): string | null {
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/** Concatenated content of code/text files in the workspace (for symbol existence checks). */
function workspaceCorpus(cwd: string): string {
  const parts: string[] = [];
  const stack = [resolve(cwd)];
  let budget = 4000;
  while (stack.length && budget-- > 0) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(join(dir, e.name));
      } else if (e.isFile() && /\.(m?[jt]sx?|cjs|py|go|rs|java|rb|php|json)$/i.test(e.name)) {
        const c = readSafe(join(dir, e.name));
        if (c) parts.push(c);
      }
    }
  }
  return parts.join("\n");
}

function scriptsOf(cwd: string): Set<string> | null {
  const pkg = readSafe(resolve(cwd, "package.json"));
  if (!pkg) return null;
  try {
    const j = JSON.parse(pkg) as { scripts?: Record<string, string> };
    return new Set(Object.keys(j.scripts ?? {}));
  } catch {
    return null;
  }
}

/** References made by the given doc files that don't resolve against the real workspace. */
export function checkGroundedness(files: string[], cwd: string): MissingRef[] {
  const missing: MissingRef[] = [];
  let corpus: string | null = null; // lazily built only if symbols are referenced
  const scripts = scriptsOf(cwd);
  for (const f of files) {
    let abs: string;
    let content: string | null;
    try {
      abs = resolveInside(cwd, f);
      content = readSafe(abs);
    } catch {
      continue;
    }
    if (content == null) continue;
    const base = dirname(abs);

    for (const ref of extractPathRefs(content)) {
      const ok = existsSafe(resolve(base, ref)) || existsSafe(resolve(cwd, ref));
      if (!ok) missing.push({ file: f, ref, kind: "path" });
    }

    const symbols = extractSymbolRefs(content);
    if (symbols.length) {
      corpus ??= workspaceCorpus(cwd);
      for (const id of symbols) {
        if (!new RegExp(`\\b${escapeRe(id)}\\b`).test(corpus)) missing.push({ file: f, ref: `${id}()`, kind: "symbol" });
      }
    }

    if (scripts) {
      for (const s of extractScriptRefs(content)) {
        if (!scripts.has(s)) missing.push({ file: f, ref: `npm run ${s}`, kind: "script" });
      }
    }
  }
  return missing;
}

function existsSafe(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function groundednessFeedback(missing: MissingRef[]): string {
  const byFile = new Map<string, string[]>();
  for (const m of missing) {
    if (!byFile.has(m.file)) byFile.set(m.file, []);
    byFile.get(m.file)!.push(`${m.ref} (${m.kind})`);
  }
  const lines = [...byFile.entries()].map(([f, refs]) => `- in ${f}: ${[...new Set(refs)].join(", ")}`);
  return (
    "Groundedness check: these references do not exist in the workspace — they appear invented:\n" +
    lines.join("\n") +
    "\nFix each: point it at the real path/symbol/script (use ls/glob/grep to find it), or remove the claim. " +
    "Never reference a file, function, or script that does not exist."
  );
}

// ---- meaning preservation (for edits) ----

/** Distinctive technical facts in a document: numbers, backticked tokens, and URLs. */
export function extractFacts(text: string): Set<string> {
  const facts = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]{1,60})`/g)) facts.add(m[1]!.trim());
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s)]+/g)) facts.add(m[0]!);
  for (const m of text.matchAll(/(?<![\w.])\d[\d.,]*\b/g)) {
    const n = m[0]!.replace(/[.,]$/, "");
    if (n.length >= 1) facts.add(n);
  }
  return facts;
}

export interface DroppedFact {
  file: string;
  fact: string;
}

/** Facts present in the original version of an edited file but missing after the edit. */
export function checkFactsPreserved(originals: Map<string, string>, cwd: string): DroppedFact[] {
  const dropped: DroppedFact[] = [];
  for (const [f, before] of originals) {
    let after: string | null;
    try {
      after = readSafe(resolveInside(cwd, f));
    } catch {
      continue;
    }
    if (after == null) continue;
    const afterFacts = extractFacts(after);
    for (const fact of extractFacts(before)) {
      // A fact survives if it appears verbatim anywhere in the new text.
      if (!after.includes(fact) && !afterFacts.has(fact)) dropped.push({ file: f, fact });
    }
  }
  return dropped;
}

export function meaningFeedback(dropped: DroppedFact[]): string {
  const byFile = new Map<string, string[]>();
  for (const d of dropped) {
    if (!byFile.has(d.file)) byFile.set(d.file, []);
    byFile.get(d.file)!.push(`\`${d.fact}\``);
  }
  const lines = [...byFile.entries()].map(([f, facts]) => `- in ${f}: ${[...new Set(facts)].join(", ")}`);
  return (
    "Meaning-preservation check: your edit removed or changed these technical facts from the original:\n" +
    lines.join("\n") +
    "\nFor EACH: if the task asked you to change it (e.g. updating a version or a renamed symbol), keep your change. " +
    "Otherwise it was an accidental loss while editing — restore the original fact verbatim. An edit may change " +
    "wording, tone, and structure, but must never *accidentally* drop a number, name, path, command, or URL."
  );
}

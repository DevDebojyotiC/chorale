import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { resolveInside } from "../tools/permissions.js";

/**
 * Groundedness check (anti-hallucination) for doc-writing agents like the scribe.
 * The dominant failure in generated docs is referencing files/paths that don't exist.
 * We extract the intra-repo path references a doc CLAIMS exist and verify them on disk;
 * anything missing is fed back for a fix. Conservative by design — only strong "this
 * path exists" signals are checked, so it rarely false-positives on illustrative text.
 */

export interface MissingRef {
  /** The doc that made the claim (workspace-relative). */
  file: string;
  /** The referenced path that does not exist. */
  ref: string;
}

/** Extract path references a document asserts exist: markdown relative links + backticked repo paths. */
export function extractPathRefs(text: string): string[] {
  const refs = new Set<string>();

  // Markdown links: [text](target) — a strong "this path exists" claim.
  for (const m of text.matchAll(/\]\(([^)\s]+)/g)) {
    const raw = (m[1] ?? "").trim().split(/[#?]/)[0]!; // drop anchor/query
    if (!raw || /^(https?:|mailto:|tel:|data:|\/\/|#)/i.test(raw)) continue;
    refs.add(raw);
  }

  // Backticked tokens that clearly look like a repo path: a slash AND a file extension.
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    const t = (m[1] ?? "").trim();
    if (/^[\w.@-]+(\/[\w.@-]+)+$/.test(t) && /\.[a-z0-9]{1,6}$/i.test(t) && !/^https?:/i.test(t)) refs.add(t);
  }

  return [...refs];
}

/** Return references made by the given (workspace-relative) doc files that don't resolve on disk. */
export function checkGroundedness(files: string[], cwd: string): MissingRef[] {
  const missing: MissingRef[] = [];
  for (const f of files) {
    let abs: string;
    let content: string;
    try {
      abs = resolveInside(cwd, f);
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const base = dirname(abs);
    for (const ref of extractPathRefs(content)) {
      // Accept if it resolves relative to the doc's own directory OR the workspace root.
      let ok = false;
      try {
        ok = existsSync(resolve(base, ref)) || existsSync(resolve(cwd, ref));
      } catch {
        ok = false;
      }
      if (!ok) missing.push({ file: f, ref });
    }
  }
  return missing;
}

/** Repair feedback naming the invented references so the model can fix or remove them. */
export function groundednessFeedback(missing: MissingRef[]): string {
  const byFile = new Map<string, string[]>();
  for (const m of missing) {
    if (!byFile.has(m.file)) byFile.set(m.file, []);
    byFile.get(m.file)!.push(m.ref);
  }
  const lines = [...byFile.entries()].map(([f, refs]) => `- in ${f}: ${[...new Set(refs)].map((r) => `\`${r}\``).join(", ")}`);
  return (
    "Groundedness check: these path references do not exist in the workspace — they appear to be invented:\n" +
    lines.join("\n") +
    "\nFix each one: point it at the correct existing path (use ls/glob/grep to find it), or remove the claim. " +
    "Do not reference files that do not exist."
  );
}

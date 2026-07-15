import { transform } from "esbuild";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { resolveInside } from "../tools/permissions.js";

export interface VerifyIssue {
  file: string;
  message: string;
}

function esbuildError(e: unknown): string {
  const err = e as {
    errors?: Array<{ text: string; location?: { line: number } | null }>;
    message?: string;
  };
  if (err.errors?.length) {
    return err.errors.map((x) => `${x.text}${x.location ? ` (line ${x.location.line})` : ""}`).join("; ");
  }
  return err.message ?? String(e);
}

async function checkSyntax(code: string, loader: "js" | "jsx" | "ts" | "tsx"): Promise<string | null> {
  try {
    await transform(code, { loader });
    return null;
  } catch (e) {
    return esbuildError(e);
  }
}

// Inline <script> without a src attribute (i.e. code we should syntax-check).
const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Syntax-verify a set of workspace files (JS/TS/JSX/TSX, JSON, and inline scripts
 * in HTML). Fast and dependency-free (esbuild). Returns any issues found — this is
 * the signal the coder's verify-repair loop feeds back to the model.
 */
export async function verifyFiles(files: string[], cwd: string): Promise<VerifyIssue[]> {
  const issues: VerifyIssue[] = [];
  for (const file of files) {
    let code: string;
    try {
      code = readFileSync(resolveInside(cwd, file), "utf8");
    } catch {
      continue; // deleted / unreadable — nothing to verify
    }
    const ext = extname(file).toLowerCase();

    if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
      const err = await checkSyntax(code, "js");
      if (err) issues.push({ file, message: err });
    } else if (ext === ".jsx") {
      const err = await checkSyntax(code, "jsx");
      if (err) issues.push({ file, message: err });
    } else if (ext === ".ts" || ext === ".mts" || ext === ".cts") {
      const err = await checkSyntax(code, "ts");
      if (err) issues.push({ file, message: err });
    } else if (ext === ".tsx") {
      const err = await checkSyntax(code, "tsx");
      if (err) issues.push({ file, message: err });
    } else if (ext === ".json") {
      try {
        JSON.parse(code);
      } catch (e) {
        issues.push({ file, message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` });
      }
    } else if (ext === ".html" || ext === ".htm") {
      let i = 0;
      for (const m of code.matchAll(INLINE_SCRIPT_RE)) {
        i++;
        const script = m[1] ?? "";
        if (!script.trim()) continue;
        const err = await checkSyntax(script, "js");
        if (err) issues.push({ file, message: `inline <script> #${i}: ${err}` });
      }
    }
    // Other extensions are left unverified here (extend as needed).
  }
  return issues;
}

/** Format verify issues into a corrective instruction for the model. */
export function verifyFeedback(issues: VerifyIssue[]): string {
  const lines = issues.map((i) => `- ${i.file}: ${i.message}`).join("\n");
  return (
    `Automated syntax verification found ${issues.length} problem(s) in the code you just wrote. ` +
    `Re-read the affected file(s) with the read tool, fix ONLY these issues, and save. ` +
    `A common cause is writing literal "\\n" sequences into code instead of real newlines. ` +
    `Do not add commentary — just make the fix.\n\n${lines}`
  );
}

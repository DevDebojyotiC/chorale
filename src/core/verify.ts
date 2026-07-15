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

/** Detect an error whose root cause is a backtick / template-literal problem. */
function isTemplateLiteralError(issues: VerifyIssue[]): boolean {
  return issues.some((i) => /[`]|template literal|unterminated string|unterminated template/i.test(i.message));
}

/**
 * Error-specific repair guidance — the coder compensating for a known failure mode.
 * The dominant hard-file failure is a big HTML page (often with an inline <script>
 * that itself uses backticks) embedded in a JS template literal: a nested backtick
 * closes the string early. Generic "rewrite it" feedback doesn't fix that; naming the
 * cause AND the escape-the-trap strategy (serve HTML from a file) does.
 */
function targetedHint(issues: VerifyIssue[]): string {
  if (!isTemplateLiteralError(issues)) return "";
  return (
    "\n\nAT LEAST ONE ERROR IS A BACKTICK / TEMPLATE-LITERAL PROBLEM. This almost always means you " +
    "embedded a large HTML page — often containing a <script> that itself uses backticks or ${...} — " +
    "inside a JS template literal, and a nested backtick closed the string early. Do NOT try to escape " +
    "your way out. Instead RESTRUCTURE: write the HTML to a SEPARATE file (e.g. `index.html` or " +
    "`public/index.html`) as a normal file, and in the server read and serve it with " +
    "`readFileSync(new URL('./index.html', import.meta.url), 'utf8')`. Keep any JS the page needs inside " +
    "that .html file's own <script>. This removes every nested-backtick trap. Rewrite it this way now."
  );
}

/** Format verify issues into a corrective instruction for the model. */
export function verifyFeedback(issues: VerifyIssue[]): string {
  const lines = issues.map((i) => `- ${i.file}: ${i.message}`).join("\n");
  const files = [...new Set(issues.map((i) => i.file))].join(", ");
  return (
    `Automated syntax verification FAILED on the code you just wrote (${issues.length} problem(s)). ` +
    `The file does not parse, so your previous attempt does not count. ` +
    `Write the COMPLETE corrected file again with the write tool — a full, self-contained rewrite of ${files}, ` +
    `not a patch and not the same text. Fix the exact error(s) below at the reported line(s). ` +
    `Common causes: an extra or missing ) ] } , a string closed early, or literal "\\n" sequences instead of real newlines. ` +
    `Output only the write tool call.${targetedHint(issues)}\n\n${lines}`
  );
}

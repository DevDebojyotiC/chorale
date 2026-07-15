/**
 * Diagnose-and-compensate registry. Given the error text from syntax verification
 * or a runtime self-heal smoke test, return targeted, actionable fixes — so the
 * repair loop names the *cause* and the *fix* instead of a generic "rewrite it".
 *
 * This is model-agnostic (it keys off the error, not the model) and applies to any
 * error the loop encounters when verify / selfHeal are on. Extend it by adding rules;
 * a future self-learning pass (Phase 3) can append rules learned from real failures.
 */
export interface Diagnosis {
  /** Matches the combined error message(s). */
  test: RegExp;
  /** Actionable guidance appended to the repair feedback. */
  hint: string;
}

export const DIAGNOSES: Diagnosis[] = [
  {
    // The proven one: big HTML embedded in a JS template literal → nested backtick closes the string early.
    test: /[`]|template literal|unterminated template|unterminated string/i,
    hint:
      "A backtick / template-literal problem — usually a large HTML page (often with an inline <script> that itself uses backticks or ${...}) embedded in a JS template literal, so a nested backtick closes the string early. " +
      "Do NOT try to escape it. RESTRUCTURE: write the HTML to a SEPARATE file (e.g. index.html) and serve it with readFileSync(new URL('./index.html', import.meta.url), 'utf8'). This removes every nested-backtick trap.",
  },
  {
    test: /Cannot use import statement outside a module|Unexpected token ['"]?export|require is not defined|exports is not defined|module is not defined|__dirname is not defined|__filename is not defined/i,
    hint:
      "An ESM/CJS mismatch — this is an ES module (.mjs). Use import/export, not require or module.exports. For built-ins use `import { x } from \"node:fs\"`; for paths use `new URL('./f', import.meta.url)` instead of __dirname.",
  },
  {
    test: /Cannot find module|ERR_MODULE_NOT_FOUND|Failed to resolve|Could not resolve/i,
    hint:
      "A module path is wrong. Use correct relative paths WITH the file extension (e.g. \"./util.mjs\"), prefix Node built-ins with \"node:\", and only import files you actually created.",
  },
  {
    test: /EADDRINUSE|address already in use|listen EACCES/i,
    hint:
      "The port is unavailable — almost always because it is hardcoded. Read it from process.env.PORT (with a default only as a fallback) so each run can bind a free port.",
  },
  {
    test: /is not a function/i,
    hint:
      "You called something that isn't a function — often a wrong import/export name. Make sure the exported names exactly match what you import and call.",
  },
  {
    // "is not defined" for a normal identifier — but NOT require/exports/module/__dirname
    // (those are the ESM/CJS mismatch handled by the specific rule above).
    test: /(?<!(?:require|exports|module|__dirname|__filename) )\bis not defined\b|ReferenceError/i,
    hint:
      "A name is used but never declared or imported. Declare it, or add the missing import.",
  },
  {
    test: /await is only valid|Unexpected reserved word|Top-level await/i,
    hint:
      "Invalid use of await/reserved word — wrap the code in an async function, or use .then().",
  },
  {
    test: /literal \\n|\\\\n|\\n(?!ewline)/,
    hint:
      "You may have written literal \\n sequences instead of real line breaks. Emit real newlines in source.",
  },
  {
    test: /Expected .* but (found|got)|Unexpected (end of|token)|missing \)|Unterminated/i,
    hint:
      "A bracket, paren, brace, quote, or comma is missing or extra. Re-read the reported line(s) and balance them.",
  },
];

/** Return targeted, deduped guidance for whichever diagnoses match the error text. */
export function diagnose(messages: string[]): string {
  const blob = messages.join("\n");
  const hints = [...new Set(DIAGNOSES.filter((d) => d.test.test(blob)).map((d) => d.hint))];
  if (hints.length === 0) return "";
  return "\n\nLikely cause(s) and the fix:\n" + hints.map((h) => `• ${h}`).join("\n");
}

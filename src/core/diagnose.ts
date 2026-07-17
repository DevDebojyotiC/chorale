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
  /** Stable category id — used to key learned lessons and dedupe. */
  key: string;
  /** Matches the combined error message(s). */
  test: RegExp;
  /** Actionable guidance appended to the repair feedback. */
  hint: string;
}

export const DIAGNOSES: Diagnosis[] = [
  {
    key: "template-literal",
    // The proven one: big HTML embedded in a JS template literal → nested backtick closes the string early.
    test: /[`]|template literal|unterminated template|unterminated string/i,
    hint:
      "A backtick / template-literal problem — usually a large HTML page (often with an inline <script> that itself uses backticks or ${...}) embedded in a JS template literal, so a nested backtick closes the string early. " +
      "Do NOT try to escape it. RESTRUCTURE: write the HTML to a SEPARATE file (e.g. index.html) and serve it with readFileSync(new URL('./index.html', import.meta.url), 'utf8'). This removes every nested-backtick trap.",
  },
  {
    key: "esm-cjs",
    test: /Cannot use import statement outside a module|Unexpected token ['"]?export|require is not defined|exports is not defined|module is not defined|__dirname is not defined|__filename is not defined/i,
    hint:
      "An ESM/CJS mismatch — this is an ES module (.mjs). Use import/export, not require or module.exports. For built-ins use `import { x } from \"node:fs\"`; for paths use `new URL('./f', import.meta.url)` instead of __dirname.",
  },
  {
    key: "module-path",
    test: /Cannot find module|ERR_MODULE_NOT_FOUND|Failed to resolve|Could not resolve/i,
    hint:
      "A module path is wrong. Use correct relative paths WITH the file extension (e.g. \"./util.mjs\"), prefix Node built-ins with \"node:\", and only import files you actually created.",
  },
  {
    key: "port",
    test: /EADDRINUSE|address already in use|listen EACCES/i,
    hint:
      "The port is unavailable — almost always because it is hardcoded. Read it from process.env.PORT (with a default only as a fallback) so each run can bind a free port.",
  },
  {
    key: "bad-export",
    test: /is not a function/i,
    hint:
      "You called something that isn't a function — often a wrong import/export name. Make sure the exported names exactly match what you import and call.",
  },
  {
    key: "undefined-name",
    // "is not defined" for a normal identifier — but NOT require/exports/module/__dirname
    // (those are the ESM/CJS mismatch handled by the specific rule above).
    test: /(?<!(?:require|exports|module|__dirname|__filename) )\bis not defined\b|ReferenceError/i,
    hint:
      "A name is used but never declared or imported. Declare it, or add the missing import.",
  },
  {
    key: "async-syntax",
    test: /await is only valid|Unexpected reserved word|Top-level await/i,
    hint:
      "Invalid use of await/reserved word — wrap the code in an async function, or use .then().",
  },
  {
    key: "literal-newline",
    test: /literal \\n|\\\\n|\\n(?!ewline)/,
    hint:
      "You may have written literal \\n sequences instead of real line breaks. Emit real newlines in source.",
  },
  {
    key: "delimiters",
    test: /Expected .* but (found|got)|Unexpected (end of|token)|missing \)|Unterminated/i,
    hint:
      "A bracket, paren, brace, quote, or comma is missing or extra. Re-read the reported line(s) and balance them.",
  },
  {
    key: "ts-node-loader",
    test: /ts-node|Cannot read properties of undefined \(reading 'fileExists'\)|Unknown file extension "?\.ts"?|ERR_UNKNOWN_FILE_EXTENSION/i,
    hint:
      "The app runs TypeScript through ts-node (or a plain-node entry that imports .ts with no loader). ts-node breaks against newer TypeScript versions and is fragile in ESM. Use tsx instead: add tsx as a devDependency and set the start script to `tsx <entry>` (e.g. \"start\": \"tsx index.js\"); remove any `require('ts-node').register(...)` call. tsx uses esbuild and does not depend on the installed TypeScript version.",
  },
  {
    key: "sqlite-dir",
    test: /Cannot open database because the directory does not exist|SQLITE_CANTOPEN|unable to open database file/i,
    hint:
      "A file-based database (e.g. better-sqlite3) is being opened in a directory that doesn't exist — the driver creates the file but NOT its parent folder. Before opening the DB, create the directory: `import { mkdirSync } from 'node:fs'; mkdirSync(dirname(dbPath), { recursive: true });`. Also open ONE shared connection in a single db module and import it everywhere, rather than a fresh `new Database(...)` (with a possibly different path) in each repository.",
  },
];

/** The diagnosis rules whose pattern matches the error text. */
export function matchDiagnoses(messages: string[]): Diagnosis[] {
  const blob = messages.join("\n");
  return DIAGNOSES.filter((d) => d.test.test(blob));
}

/** Return targeted, deduped guidance for whichever diagnoses match the error text. */
export function diagnose(messages: string[]): string {
  const hints = [...new Set(matchDiagnoses(messages).map((d) => d.hint))];
  if (hints.length === 0) return "";
  return "\n\nLikely cause(s) and the fix:\n" + hints.map((h) => `• ${h}`).join("\n");
}

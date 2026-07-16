/**
 * Scribe benchmark fixtures + graders. Three objective suites:
 *   - GROUNDEDNESS: generate a README for a real project → precision (no invented path
 *     refs, via checkGroundedness) + recall (documents the real entry/scripts).
 *   - STALENESS: docs planted with inaccuracies (renamed symbol, dead link, wrong
 *     version) → did the scribe catch each?
 *   - EDIT: fix prose grammar while PRESERVING technical facts → typos gone, facts kept.
 * Graders are pure + self-validated by scribe-selftest.ts (no model calls).
 */

export interface FileMap {
  [path: string]: string;
}

/** A project to write a README for; graded on grounded (real) + covered (mentions key refs). */
export interface GroundFixture {
  id: string;
  files: FileMap;
  /** Real public-API symbols the README should document — recall (did it cover what exists). */
  expect: string[];
}

export const GROUND: GroundFixture[] = [
  {
    id: "greeter",
    files: {
      "src/index.mjs": "export function greet(name) {\n  return `Hello, ${name}!`;\n}\n",
      "package.json": JSON.stringify({ name: "greeter", version: "0.1.0", scripts: { test: "node --test" } }, null, 2) + "\n",
    },
    // No LICENSE, no docs/, no build script — a model on autopilot invents those (precision test).
    expect: ["greet"],
  },
  {
    id: "calc-lib",
    files: {
      "lib/add.mjs": "export const add = (a, b) => a + b;\n",
      "lib/index.mjs": "export { add } from './add.mjs';\n",
      "package.json": JSON.stringify({ name: "calc", version: "1.2.0", main: "lib/index.mjs", scripts: { test: "vitest" } }, null, 2) + "\n",
    },
    expect: ["add"],
  },
];

/** Docs planted with inaccuracies vs the code; the scribe must find them. */
export interface StaleFixture {
  id: string;
  files: FileMap;
  target: string; // the doc to check
  planted: { key: string; terms: string[] }[];
}

export const STALE: StaleFixture[] = [
  {
    id: "renamed-and-dead-link",
    files: {
      "src/api.mjs": "export async function fetchUser(id) {\n  return { id };\n}\n",
      "package.json": JSON.stringify({ name: "app", version: "2.1.0" }, null, 2) + "\n",
      "README.md":
        "# App\n\nCall `getUser(id)` to load a user. See the [guide](docs/guide.md).\n\nCurrent version: 1.0.0.\n",
    },
    target: "README.md",
    planted: [
      { key: "renamed-symbol", terms: ["getuser", "fetchuser", "renamed", "no longer", "does not exist", "no such"] },
      { key: "dead-link", terms: ["docs/guide.md", "dead link", "broken link", "missing", "does not exist"] },
      { key: "wrong-version", terms: ["1.0.0", "2.1.0", "version", "outdated", "stale", "mismatch"] },
    ],
  },
];

/** Prose to fix; typos must be removed and technical facts preserved. */
export interface EditFixture {
  id: string;
  file: string;
  content: string;
  mustFixGone: string[]; // typos/errors that must NOT survive
  mustKeep: string[]; // technical facts that must survive verbatim
}

export const EDIT: EditFixture[] = [
  {
    id: "retry-doc",
    file: "notes.md",
    content: "The functon retrys the requst up to 3 times, and if it keeps failing it throw's an error on port 8080.",
    mustFixGone: ["functon", "retrys", "requst", "throw's"],
    mustKeep: ["3", "8080"],
  },
];

// ---- graders (pure) ----

/** Recall: which expected refs the README mentions. */
export function gradeGroundRecall(readme: string, expect: string[]): { covered: string[]; missed: string[] } {
  const covered: string[] = [];
  const missed: string[] = [];
  for (const e of expect) (readme.includes(e) ? covered : missed).push(e);
  return { covered, missed };
}

/** Staleness: which planted issues the review names (any accepted term present). */
export function gradeStaleness(review: string, planted: StaleFixture["planted"]): { caught: string[]; missed: string[] } {
  const lower = review.toLowerCase();
  const caught: string[] = [];
  const missed: string[] = [];
  for (const p of planted) (p.terms.some((t) => lower.includes(t.toLowerCase())) ? caught : missed).push(p.key);
  return { caught, missed };
}

/** Edit safety: typos removed AND facts preserved. */
export function gradeEdit(edited: string, f: EditFixture): { typosLeft: string[]; factsDropped: string[]; ok: boolean } {
  const typosLeft = f.mustFixGone.filter((t) => edited.includes(t));
  const factsDropped = f.mustKeep.filter((k) => !edited.includes(k));
  return { typosLeft, factsDropped, ok: typosLeft.length === 0 && factsDropped.length === 0 };
}

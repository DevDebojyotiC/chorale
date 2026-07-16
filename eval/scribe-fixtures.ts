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

// ---- generalized suites (file-producing / answer-text) ----

/** A task that produces or edits a FILE; graded on its content. */
export interface GenFixture {
  id: string;
  cap: string; // capability label
  files: FileMap;
  prompt: string;
  outFile: string; // the file the scribe must produce/update
  mode: "full-auto"; // writes
  expectTerms: string[]; // recall — real things the output must mention
  mustAbsent?: string[]; // must NOT appear (e.g. a corrected stale value)
  structure?: string; // regex the output must match (e.g. Keep-a-Changelog sections)
}

/** A task whose ANSWER TEXT is graded (summaries, extraction, Q&A). */
export interface TextFixture {
  id: string;
  cap: string;
  files: FileMap;
  prompt: string;
  mode: "read-only";
  expectTerms: string[];
  mustAbsent?: string[];
  structure?: string;
}

/** A reorganization task graded by resulting file layout + preserved links. */
export interface ReorgFixture {
  id: string;
  cap: string;
  files: FileMap;
  prompt: string;
  expectExists: string[]; // files that must exist after
  expectGone: string[]; // files that must be gone after
  linkStillResolves: { file: string; mustContain: string }[]; // a link that must have been updated
}

export function gradeContent(
  text: string,
  f: { expectTerms: string[]; mustAbsent?: string[]; structure?: string },
): { missed: string[]; present: string[]; leaked: string[]; structureOk: boolean; ok: boolean } {
  const lower = text.toLowerCase();
  const present = f.expectTerms.filter((t) => lower.includes(t.toLowerCase()));
  const missed = f.expectTerms.filter((t) => !lower.includes(t.toLowerCase()));
  const leaked = (f.mustAbsent ?? []).filter((t) => lower.includes(t.toLowerCase()));
  const structureOk = f.structure ? new RegExp(f.structure, "m").test(text) : true;
  return { missed, present, leaked, structureOk, ok: missed.length === 0 && leaked.length === 0 && structureOk };
}

export const GEN: GenFixture[] = [
  {
    id: "api-docs",
    cap: "API/reference docs",
    files: {
      "src/math.mjs": "export function add(a, b) { return a + b; }\nexport function mul(a, b) { return a * b; }\n",
    },
    prompt: "Read src/math.mjs and write API.md documenting every exported function (name + what it does). Document only what exists.",
    outFile: "API.md",
    mode: "full-auto",
    expectTerms: ["add", "mul"],
  },
  {
    id: "changelog",
    cap: "CHANGELOG generation",
    files: {
      "COMMITS.md": "- feat: add dark mode toggle\n- fix: crash on empty input\n- feat: export to CSV\n",
    },
    prompt: "Read COMMITS.md and write CHANGELOG.md in Keep-a-Changelog format (group the commits under Added / Fixed).",
    outFile: "CHANGELOG.md",
    mode: "full-auto",
    expectTerms: ["dark mode", "empty input", "CSV"],
    structure: "^###?\\s+(Added|Fixed)",
  },
  {
    id: "docstring",
    cap: "inline docstrings",
    files: { "util.mjs": "export function clamp(n, lo, hi) {\n  return Math.max(lo, Math.min(hi, n));\n}\n" },
    prompt: "Add a JSDoc /** */ comment above the clamp function in util.mjs documenting its parameters n, lo, hi. Keep the code unchanged.",
    outFile: "util.mjs",
    mode: "full-auto",
    expectTerms: ["clamp", "lo", "hi"],
    structure: "/\\*\\*",
  },
  {
    id: "architecture",
    cap: "architecture doc",
    files: {
      "src/server.mjs": "export const server = 1;\n",
      "src/db.mjs": "export const db = 1;\n",
      "src/router.mjs": "export const router = 1;\n",
    },
    prompt: "Read the files under src/ and write ARCHITECTURE.md describing each module. Document only the modules that exist.",
    outFile: "ARCHITECTURE.md",
    mode: "full-auto",
    expectTerms: ["server", "db", "router"],
  },
  {
    id: "inventory",
    cap: "docs index / inventory",
    files: {
      "docs/intro.md": "# Intro\n",
      "docs/setup.md": "# Setup\n",
      "docs/faq.md": "# FAQ\n",
    },
    prompt: "Create docs/INDEX.md listing and briefly describing every markdown file in docs/. Link to each.",
    outFile: "docs/INDEX.md",
    mode: "full-auto",
    expectTerms: ["intro.md", "setup.md", "faq.md"],
  },
  {
    id: "sync-apply",
    cap: "sync-apply (fix stale doc)",
    files: {
      "src/api.mjs": "export function fetchUser(id) { return { id }; }\n",
      "package.json": JSON.stringify({ name: "app", version: "2.1.0" }, null, 2) + "\n",
      "README.md": "# App\n\nCall `getUser(id)` to load a user. Version 1.0.0.\n",
    },
    prompt: "Update README.md so it matches the code: fix the function name to the one that actually exists in src/api.mjs, and fix the version to match package.json.",
    outFile: "README.md",
    mode: "full-auto",
    expectTerms: ["fetchUser", "2.1.0"],
    mustAbsent: ["getUser", "1.0.0"],
  },
  {
    id: "toc",
    cap: "TOC / restructure",
    files: {
      "guide.md": "# Guide\n\n## Install\n\ntext\n\n## Usage\n\ntext\n\n## FAQ\n\ntext\n",
    },
    prompt: "Add a Table of Contents to guide.md right after the title, linking to each section heading. Keep all existing content.",
    outFile: "guide.md",
    mode: "full-auto",
    expectTerms: ["install", "usage", "faq"],
    structure: "\\]\\(#",
  },
  {
    id: "scaffolding",
    cap: "scaffolding (CONTRIBUTING)",
    files: { "package.json": JSON.stringify({ name: "app", scripts: { test: "vitest", build: "tsup" } }, null, 2) + "\n" },
    prompt: "Write CONTRIBUTING.md with a '## Development' section that lists the real npm scripts from package.json. Document only scripts that exist.",
    outFile: "CONTRIBUTING.md",
    mode: "full-auto",
    expectTerms: ["test", "build"],
    structure: "^##\\s",
  },
  {
    id: "multi-doc-synthesis",
    cap: "multi-doc synthesis",
    files: {
      "a.md": "# Auth\n\nAuth uses JWT tokens.\n",
      "b.md": "# Billing\n\nBilling runs on Stripe.\n",
    },
    prompt: "Read a.md and b.md and merge them into OVERVIEW.md that covers both topics in one coherent document.",
    outFile: "OVERVIEW.md",
    mode: "full-auto",
    expectTerms: ["jwt", "stripe"],
  },
  {
    id: "formatting",
    cap: "formatting normalization",
    files: { "messy.md": "#Title\ntext here\n-item one\n-item two\n" },
    prompt: "Normalize the Markdown formatting in messy.md — a space after the '#' heading and after each '-' list marker. Keep all the words.",
    outFile: "messy.md",
    mode: "full-auto",
    expectTerms: ["title", "item one", "item two"],
    structure: "^#\\s+\\S",
  },
  {
    id: "consistency",
    cap: "cross-doc consistency",
    files: {
      "package.json": JSON.stringify({ name: "app", version: "2.0.0" }, null, 2) + "\n",
      "docs/b.md": "# B\n\nThis is version 1.5.0 of the app.\n",
    },
    prompt: "The version in docs/b.md is out of date. Update it to match package.json.",
    outFile: "docs/b.md",
    mode: "full-auto",
    expectTerms: ["2.0.0"],
    mustAbsent: ["1.5.0"],
  },
];

export const TEXT: TextFixture[] = [
  {
    id: "summary",
    cap: "summarization fidelity",
    files: {
      "report.md":
        "# Q3 Report\n\nRevenue grew 20% to $4M. The mobile app launched in July. Churn fell to 3%. We hired 5 engineers.\n",
    },
    prompt: "Read report.md and give a 2-sentence summary of the key facts.",
    mode: "read-only",
    expectTerms: ["20%", "mobile", "churn"],
  },
  {
    id: "extract-todos",
    cap: "extraction (action items)",
    files: {
      "notes.md": "Meeting notes.\n\n- TODO: migrate the database\n- discussion about pricing\n- TODO: write the launch email\n- TODO: fix the login bug\n",
    },
    prompt: "Read notes.md and list every action item / TODO as a bullet list.",
    mode: "read-only",
    expectTerms: ["migrate the database", "launch email", "login bug"],
  },
  {
    id: "structured",
    cap: "structured extraction (table)",
    files: {
      "people.md": "Ada is 36 and works in Research. Bob is 41 in Sales. Cy is 29 in Design.\n",
    },
    prompt: "Read people.md and produce a Markdown table with columns Name, Age, Department for each person.",
    mode: "read-only",
    expectTerms: ["Ada", "36", "Research", "Bob", "Sales", "Cy", "Design"],
    structure: "\\|.*\\|.*\\|",
  },
  {
    id: "tone",
    cap: "tone / style rewrite",
    files: { "blurb.md": "I think we should probably maybe try to use the API, and I really love it.\n" },
    prompt: "Rewrite blurb.md's text in neutral, third-person technical documentation style. Output only the rewritten sentence.",
    mode: "read-only",
    expectTerms: ["api"],
    mustAbsent: ["I think", "I really", " we should"],
  },
  {
    id: "qa",
    cap: "local grounded Q&A",
    files: {
      "docs/config.md": "# Config\n\nThe server listens on port 8080 by default. Set PORT to override.\n",
      "docs/intro.md": "# Intro\n\nWelcome.\n",
    },
    prompt: "What port does the server listen on by default, and which file documents it? Cite the file.",
    mode: "read-only",
    expectTerms: ["8080", "config.md"],
  },
  {
    id: "example-validation",
    cap: "example validation",
    files: {
      "package.json": JSON.stringify({ name: "app", scripts: { build: "tsup" } }, null, 2) + "\n",
      "README.md": "# App\n\nRun `npm run build` to build, then `npm run deploy` to ship.\n",
    },
    prompt: "Read README.md and package.json. Which commands documented in README.md do NOT exist as scripts in package.json? List them.",
    mode: "read-only",
    expectTerms: ["deploy"],
    mustAbsent: ["build is missing", "build does not exist"],
  },
];

export const REORG: ReorgFixture[] = [
  {
    id: "reorganize",
    cap: "reorganize + reference-safe",
    files: {
      "readme.md": "See [notes](notes.md) and [todo](todo.md).\n",
      "notes.md": "# Notes\n",
      "todo.md": "# Todo\n",
    },
    prompt: "Move notes.md and todo.md into a new docs/ folder, and update every link in readme.md so nothing breaks.",
    expectExists: ["docs/notes.md", "docs/todo.md", "readme.md"],
    expectGone: ["notes.md", "todo.md"],
    linkStillResolves: [{ file: "readme.md", mustContain: "docs/notes.md" }],
  },
  {
    id: "naming",
    cap: "naming conventions",
    files: {
      "index.md": "See [my notes](MyNotes.md).\n",
      "MyNotes.md": "# My Notes\n",
    },
    prompt: "Rename MyNotes.md to follow kebab-case (lowercase words separated by hyphens): my-notes.md. Update the link in index.md.",
    expectExists: ["my-notes.md", "index.md"],
    expectGone: ["MyNotes.md"],
    linkStillResolves: [{ file: "index.md", mustContain: "my-notes.md" }],
  },
];

/**
 * Test-writer benchmark fixtures + graders. A test suite is only as good as the bugs it would
 * catch, so we grade by MUTATION: the generated tests must (a) PASS on the correct implementation
 * and (b) FAIL on each planted buggy mutant. A suite that passes on both is worthless — that's the
 * failure mode (trivial assertions / tests that match a bug) this benchmark exists to expose.
 *
 * Grading runs `node --test` on a real file, so it's execution-grading with no model calls; the
 * self-test (testwriter-selftest.ts) validates the graders, and testwriter-bench.ts runs the live
 * agent against the same graders.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Mutant {
  id: string;
  /** A buggy version of the module — a correct test suite must FAIL on it. */
  source: string;
}

export interface TWFixture {
  id: string;
  /** The natural-language spec handed to the test-writer. */
  spec: string;
  /** The function the module exports (so tests know what to import). */
  exportName: string;
  /** The correct implementation — tests must PASS here. */
  correct: string;
  /** Buggy variants — tests must FAIL on each (a "kill"). */
  mutants: Mutant[];
  /** A hand-authored good test suite — the oracle used by the self-test. */
  goldTest: string;
}

/** Convention shared with the agent: the module under test is `target.mjs`; tests import from it. */
export const MODULE_FILE = "target.mjs";
export const TEST_FILE = "target.test.mjs";

export const FIXTURES: TWFixture[] = [
  {
    id: "clamp",
    spec: "Write tests for `clamp(x, lo, hi)`, which returns x limited to the range [lo, hi]: lo if x < lo, hi if x > hi, otherwise x.",
    exportName: "clamp",
    correct: `export function clamp(x, lo, hi) {\n  if (x < lo) return lo;\n  if (x > hi) return hi;\n  return x;\n}\n`,
    mutants: [
      { id: "no-clamp", source: `export function clamp(x, lo, hi) {\n  return x;\n}\n` },
      { id: "ignores-hi", source: `export function clamp(x, lo, hi) {\n  if (x < lo) return lo;\n  return x;\n}\n` },
      { id: "wrong-op", source: `export function clamp(x, lo, hi) {\n  if (x > lo) return lo;\n  if (x > hi) return hi;\n  return x;\n}\n` },
    ],
    goldTest:
      `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { clamp } from "./target.mjs";\n` +
      `test("within range is unchanged", () => assert.equal(clamp(5, 0, 10), 5));\n` +
      `test("below clamps up to lo", () => assert.equal(clamp(-3, 0, 10), 0));\n` +
      `test("above clamps down to hi", () => assert.equal(clamp(42, 0, 10), 10));\n`,
  },
  {
    id: "sum",
    spec: "Write tests for `sum(arr)`, which returns the sum of an array of numbers, and 0 for an empty array.",
    exportName: "sum",
    correct: `export const sum = (arr) => arr.reduce((n, x) => n + x, 0);\n`,
    mutants: [
      { id: "off-by-one-init", source: `export const sum = (arr) => arr.reduce((n, x) => n + x, 1);\n` },
      { id: "no-init-empty-throws", source: `export const sum = (arr) => arr.reduce((n, x) => n + x);\n` },
    ],
    goldTest:
      `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./target.mjs";\n` +
      `test("adds numbers", () => assert.equal(sum([1, 2, 3]), 6));\n` +
      `test("empty is zero", () => assert.equal(sum([]), 0));\n` +
      `test("single element", () => assert.equal(sum([5]), 5));\n`,
  },
  {
    id: "title-case",
    spec: "Write tests for `titleCase(s)`, which upper-cases the first letter of each space-separated word and lower-cases the rest (e.g. 'hELLO wORLD' → 'Hello World').",
    exportName: "titleCase",
    correct: `export const titleCase = (s) => s.split(" ").map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ");\n`,
    mutants: [
      { id: "keeps-rest-case", source: `export const titleCase = (s) => s.split(" ").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");\n` },
      { id: "only-first-word", source: `export const titleCase = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);\n` },
    ],
    goldTest:
      `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { titleCase } from "./target.mjs";\n` +
      `test("capitalizes each word", () => assert.equal(titleCase("hello world"), "Hello World"));\n` +
      `test("normalizes mixed case", () => assert.equal(titleCase("hELLO wORLD"), "Hello World"));\n`,
  },
];

/** Run a test file against a given implementation; true = the suite PASSED (exit 0). */
function runSuite(dir: string, implSource: string, testSource: string): boolean {
  writeFileSync(join(dir, MODULE_FILE), implSource, "utf8");
  writeFileSync(join(dir, TEST_FILE), testSource, "utf8");
  try {
    execFileSync(process.execPath, ["--test", TEST_FILE], { cwd: dir, timeout: 20000, stdio: "pipe" });
    return true; // exit 0 → all tests passed
  } catch {
    return false; // non-zero exit (a failing/erroring test) or timeout
  }
}

export interface TWGrade {
  id: string;
  cleanPass: boolean; // tests pass on the correct implementation
  killed: string[]; // mutants the tests caught (failed on)
  survived: string[]; // mutants that slipped through (a blind spot)
  killRate: number; // killed / total mutants
  good: boolean; // cleanPass AND every mutant killed
}

/** Grade a generated test suite by mutation: pass on correct, fail on every mutant. */
export function gradeTests(fx: TWFixture, testSource: string): TWGrade {
  const dir = mkdtempSync(join(tmpdir(), `chorale-tw-${fx.id}-`));
  try {
    const cleanPass = runSuite(dir, fx.correct, testSource);
    const killed: string[] = [];
    const survived: string[] = [];
    for (const m of fx.mutants) {
      if (runSuite(dir, m.source, testSource)) survived.push(m.id); // passed on a bug → NOT caught
      else killed.push(m.id);
    }
    const killRate = fx.mutants.length ? killed.length / fx.mutants.length : 1;
    return { id: fx.id, cleanPass, killed, survived, killRate, good: cleanPass && survived.length === 0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

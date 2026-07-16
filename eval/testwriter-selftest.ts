/**
 * Validate the test-writer's mutation grader — no model calls (it runs `node --test` on real
 * files). Proves the grader discriminates a real test suite from a worthless one:
 *   - each fixture's hand-authored GOLD suite passes on the correct code AND kills every mutant;
 *   - a TRIVIAL suite (assert(true)) passes on the correct code but kills NOTHING.
 * That asymmetry is the whole point: green isn't good enough — the tests must catch bugs.
 *
 * Run: npx tsx eval/testwriter-selftest.ts
 */
import { FIXTURES, gradeTests } from "./testwriter-fixtures.js";

let ok = true;
const check = (label: string, got: boolean, want = true): void => {
  const pass = got === want;
  if (!pass) ok = false;
  process.stdout.write(`  ${pass ? "✓" : "✗"} ${label}${pass ? "" : ` (expected ${want}, got ${got})`}\n`);
};

process.stdout.write("\ntest-writer grader — GOLD suites are good (pass clean, kill every mutant):\n");
for (const fx of FIXTURES) {
  const g = gradeTests(fx, fx.goldTest);
  check(`${fx.id}: passes on correct code`, g.cleanPass);
  check(`${fx.id}: kills all ${fx.mutants.length} mutants`, g.survived.length === 0);
  check(`${fx.id}: graded good`, g.good);
}

process.stdout.write("\ntest-writer grader — TRIVIAL suites are exposed (green but catch nothing):\n");
for (const fx of FIXTURES) {
  const trivial =
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport "./target.mjs";\n` +
    `test("it runs", () => assert.ok(true));\n`;
  const g = gradeTests(fx, trivial);
  check(`${fx.id}: trivial passes clean`, g.cleanPass); // it IS green…
  check(`${fx.id}: trivial kills nothing`, g.killRate === 0); // …but catches no bug
  check(`${fx.id}: trivial graded NOT good`, g.good, false); // so the grader fails it
}

process.stdout.write(ok ? "\n  ✓ all test-writer graders valid\n\n" : "\n  ✗ test-writer grader self-test FAILED\n\n");
process.exit(ok ? 0 : 1);

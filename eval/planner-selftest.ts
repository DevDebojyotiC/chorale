/**
 * Validate the planner graders with synthetic inputs — no model calls. Proves the graders
 * (a) pass each fixture's hand-authored gold plan, and (b) fail deliberately-broken plans on
 * exactly the dimension that's broken. This is the deterministic backbone of the benchmark;
 * planner-bench.ts runs the live model against the same graders.
 *
 * Run: npx tsx eval/planner-selftest.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURES, gradePlan, writeRepo, goldPlan } from "./planner-fixtures.js";
import { normalizePlan } from "../src/core/plan.js";

let ok = true;
const check = (label: string, got: boolean, want = true): void => {
  const pass = got === want;
  if (!pass) ok = false;
  process.stdout.write(`  ${pass ? "✓" : "✗"} ${label}${pass ? "" : ` (expected ${want}, got ${got})`}\n`);
};

const withRepo = <T>(fxId: string, files: Record<string, string>, fn: (cwd: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), `chorale-plannersel-${fxId}-`));
  try {
    writeRepo(dir, files);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

process.stdout.write("\nplanner graders — gold plans pass:\n");
for (const fx of FIXTURES) {
  withRepo(fx.id, fx.repo, (cwd) => {
    const g = gradePlan(fx, goldPlan(fx), { cwd });
    check(`${fx.id}: gold passes`, g.pass);
    check(`${fx.id}: complexity=${fx.expectComplexity}`, g.complexityOk);
    check(`${fx.id}: complete`, g.completeness === 1);
    check(`${fx.id}: delegation ok`, g.delegationOk);
    check(`${fx.id}: structure ok (validatePlan clean)`, g.structureOk);
  });
}

process.stdout.write("\nplanner graders — broken plans fail on the right dimension:\n");
const fs = FIXTURES[0]!; // fullstack-lib

// (a) unknown agent → delegation + structure fail
withRepo("break-agent", fs.repo, (cwd) => {
  const broken = normalizePlan({ ...fs.gold, steps: fs.gold.steps.map((s, i) => (i === 0 ? { ...s, agent: "wizard" } : s)) });
  const g = gradePlan(fs, broken, { cwd });
  check("unknown-agent: delegation fails", g.delegationOk, false);
  check("unknown-agent: overall fails", g.pass, false);
});

// (b) missing a required layer → completeness < 1
withRepo("break-complete", fs.repo, (cwd) => {
  const broken = normalizePlan({ ...fs.gold, steps: fs.gold.steps.filter((s) => s.layer !== "docs") });
  const g = gradePlan(fs, broken, { cwd });
  check("missing-layer: completeness < 1", g.completeness < 1);
  check("missing-layer: overall fails", g.pass, false);
});

// (c) ungrounded existing-file reference → structure fails
withRepo("break-ground", fs.repo, (cwd) => {
  const broken = normalizePlan({ ...fs.gold, steps: fs.gold.steps.map((s, i) => (i === 0 ? { ...s, files: [{ path: "src/does-not-exist.ts", status: "existing" as const }] } : s)) });
  const g = gradePlan(fs, broken, { cwd });
  check("ungrounded: structure fails", g.structureOk, false);
});

// (d) dependency cycle → structure fails
withRepo("break-cycle", fs.repo, (cwd) => {
  const p = goldPlan(fs);
  p.steps[0]!.dependsOn = [p.steps[1]!.id];
  p.steps[1]!.dependsOn = [p.steps[0]!.id];
  const g = gradePlan(fs, p, { cwd });
  check("cycle: structure fails", g.structureOk, false);
});

// (e) wrong complexity → a trivial plan graded against a complex fixture
withRepo("break-complexity", fs.repo, (cwd) => {
  const trivial = normalizePlan({ summary: "x", steps: [{ title: "do it all", agent: "coder", layer: "api", acceptance: "done" }] });
  const g = gradePlan(fs, trivial, { cwd });
  check("wrong-complexity: complexity fails", g.complexityOk, false);
});

process.stdout.write(ok ? "\n  ✓ all planner graders valid\n\n" : "\n  ✗ planner grader self-test FAILED\n\n");
process.exit(ok ? 0 : 1);

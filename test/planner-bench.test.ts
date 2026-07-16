import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURES, gradePlan, writeRepo, goldPlan } from "../eval/planner-fixtures";
import { normalizePlan } from "../src/core/plan";

// Regression guard for the planner benchmark graders (the deterministic backbone of B.3).
describe("Phase 4 — planner benchmark graders", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chorale-plangrade-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("every fixture's gold plan passes all grading dimensions", () => {
    for (const fx of FIXTURES) {
      writeRepo(dir, fx.repo);
      const g = gradePlan(fx, goldPlan(fx), { cwd: dir });
      expect(g, `${fx.id} gold`).toMatchObject({ complexityOk: true, completeness: 1, delegationOk: true, structureOk: true, pass: true });
    }
  });

  it("a broken plan fails on exactly the broken dimension", () => {
    const fx = FIXTURES[0]!; // fullstack-lib
    writeRepo(dir, fx.repo);

    // unknown agent → delegation fails
    const badAgent = normalizePlan({ ...fx.gold, steps: fx.gold.steps.map((s, i) => (i === 0 ? { ...s, agent: "wizard" } : s)) });
    expect(gradePlan(fx, badAgent, { cwd: dir }).delegationOk).toBe(false);

    // dropped required layer → completeness < 1
    const missingLayer = normalizePlan({ ...fx.gold, steps: fx.gold.steps.filter((s) => s.layer !== "docs") });
    expect(gradePlan(fx, missingLayer, { cwd: dir }).completeness).toBeLessThan(1);

    // ungrounded existing-file ref → structure fails
    const ungrounded = normalizePlan({ ...fx.gold, steps: fx.gold.steps.map((s, i) => (i === 0 ? { ...s, files: [{ path: "src/nope.ts", status: "existing" as const }] } : s)) });
    expect(gradePlan(fx, ungrounded, { cwd: dir }).structureOk).toBe(false);

    // wrong complexity → complexity fails
    const trivial = normalizePlan({ summary: "x", steps: [{ title: "all", agent: "coder", layer: "api", acceptance: "done" }] });
    expect(gradePlan(fx, trivial, { cwd: dir }).complexityOk).toBe(false);
  });
});

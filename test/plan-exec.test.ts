import { describe, it, expect } from "vitest";
import { normalizePlan } from "../src/core/plan";
import { orderSteps, stepTask, executePlan, type StepRunner } from "../src/core/plan-exec";

describe("Phase 4 — plan execution (lever #1)", () => {
  const plan = normalizePlan({
    summary: "Build a notes app",
    steps: [
      { title: "backend API", agent: "coder", layer: "api", acceptance: "endpoints work", dependsOn: [1], files: [{ path: "backend/app.js", status: "new" }] },
      { title: "schema", agent: "coder", layer: "schema", acceptance: "tables exist", files: [{ path: "backend/db.js", status: "new" }] },
      { title: "frontend", agent: "coder", layer: "ui", acceptance: "UI calls the API", dependsOn: [1] },
      { title: "tests", agent: "test-writer", layer: "tests", acceptance: "pass", dependsOn: [1] },
    ],
  });

  it("orders steps by dependency (a step never runs before its prerequisites)", () => {
    const ordered = orderSteps(plan).map((s) => s.id);
    // s2 (schema) has no deps; s1 (api) depends on s2; s3/s4 depend on s1
    expect(ordered.indexOf("s2")).toBeLessThan(ordered.indexOf("s1"));
    expect(ordered.indexOf("s1")).toBeLessThan(ordered.indexOf("s3"));
    expect(ordered.indexOf("s1")).toBeLessThan(ordered.indexOf("s4"));
    expect(ordered).toHaveLength(4); // every step included exactly once
  });

  it("stepTask is self-contained: goal + prior work + this step's title/acceptance/files", () => {
    const step = plan.steps[0]!; // backend API
    const task = stepTask(step, ["s2 [coder] schema (files: backend/db.js): created users/notes tables"], "Build a notes app");
    expect(task).toMatch(/Overall goal: Build a notes app/);
    expect(task).toMatch(/Earlier steps already ran/); // prior work threaded in
    expect(task).toMatch(/backend\/db\.js/); // so this step matches the real file
    expect(task).toMatch(/Done when: endpoints work/);
    expect(task).toMatch(/backend\/app\.js \(new\)/);
    expect(task).toMatch(/write the actual file contents now/i); // an unambiguous build instruction
  });

  it("executePlan runs EVERY step in dependency order, threading prior results forward", async () => {
    const seen: string[] = [];
    const tasksReceived: Record<string, string> = {};
    const run: StepRunner = async (agent, task, step) => {
      seen.push(step.id);
      tasksReceived[step.id] = task;
      return { ok: true, text: `did ${step.title}` };
    };
    const results = await executePlan(plan, run, { goal: "Build a notes app" });

    expect(results).toHaveLength(4); // all steps executed — not just what fits one turn
    expect(results.every((r) => r.ok)).toBe(true);
    // dependency order honored
    expect(seen.indexOf("s2")).toBeLessThan(seen.indexOf("s1"));
    expect(seen.indexOf("s1")).toBeLessThan(seen.indexOf("s3"));
    // shared contract: the frontend step's task includes a summary of the backend step it depends on
    expect(tasksReceived["s3"]).toMatch(/s1 \[coder\] backend API/);
    expect(tasksReceived["s3"]).toMatch(/did backend API/); // the actual prior result gist
  });

  it("one failed step doesn't abandon the rest of the build", async () => {
    const run: StepRunner = async (_agent, _task, step) => {
      if (step.title === "schema") throw new Error("boom");
      return { ok: true, text: "ok" };
    };
    const results = await executePlan(plan, run);
    expect(results).toHaveLength(4); // still ran everything
    expect(results.find((r) => r.title === "schema")!.ok).toBe(false);
    expect(results.filter((r) => r.ok)).toHaveLength(3);
  });
});

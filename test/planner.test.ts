import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadAgent, listAgents } from "../src/agents/loader";
import { createPlanTool } from "../src/tools/plan-tool";
import type { Plan } from "../src/core/plan";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (t: any) => (i: any) => t.execute(i, {});

describe("Phase 4 — planner agent + plan tool", () => {
  it("planner.md loads with read-only tools + the plan tool, no review gate", () => {
    const p = loadAgent(resolve("agents/planner.md"));
    expect(p.name).toBe("planner");
    expect(p.tools).toEqual(expect.arrayContaining(["read", "ls", "glob", "grep", "plan"]));
    expect(p.tools).not.toContain("write"); // it plans, it doesn't write
    expect(p.reviewGate).toBe(false); // writes no code
    expect(p.delegable).toBe(true); // the orchestrator can route to it
  });

  it("is discoverable as a delegable specialist", () => {
    const names = listAgents(resolve("agents")).filter((a) => a.delegable).map((a) => a.name);
    expect(names).toContain("planner");
  });

  it("the plan tool captures a normalized plan and returns an ack", async () => {
    let captured: Plan | null = null;
    const tool = createPlanTool({ capture: (p) => (captured = p) });
    const ack = await run(tool)({
      summary: "Build a library app",
      steps: [
        { title: "schema", agent: "coder", layer: "schema" },
        { title: "api", agent: "coder", layer: "api", dependsOn: [1] },
        { title: "tests", agent: "test-writer", layer: "tests", dependsOn: [2] },
      ],
    });
    expect(ack).toMatchObject({ ok: true, steps: 3, complexity: "complex" });
    expect(captured).not.toBeNull();
    const plan = captured! as Plan;
    expect(plan.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(plan.steps[1]!.dependsOn).toEqual(["s1"]); // numeric ref normalized
    expect(plan.complexity).toBe("complex");
  });

  it("the plan tool marks a one-step plan trivial", async () => {
    let captured: Plan | null = null;
    const tool = createPlanTool({ capture: (p) => (captured = p) });
    const ack = await run(tool)({ summary: "add pagination", steps: [{ title: "paginate", agent: "coder", layer: "api" }] });
    expect(ack).toMatchObject({ complexity: "trivial" });
    expect((captured! as Plan).complexity).toBe("trivial");
  });
});

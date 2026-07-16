import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadAgent, listAgents } from "../src/agents/loader";
import { FIXTURES, gradeTests } from "../eval/testwriter-fixtures";

describe("Phase 4 — test-writer agent", () => {
  it("loads with code + test tools, delegable, verify on, no review gate", () => {
    const tw = loadAgent(resolve("agents/test-writer.md"));
    expect(tw.name).toBe("test-writer");
    expect(tw.tools).toEqual(expect.arrayContaining(["read", "ls", "glob", "grep", "write", "edit", "multi_edit", "bash"]));
    expect(tw.verify).toBe(true);
    expect(tw.reviewGate).toBe(false);
    expect(tw.delegable).toBe(true);
  });

  it("is discoverable as a delegable specialist (so the planner can assign test steps to it)", () => {
    const names = listAgents(resolve("agents")).filter((a) => a.delegable).map((a) => a.name);
    expect(names).toContain("test-writer");
  });

  it("mutation grader: a good suite kills all mutants; a trivial suite kills none", () => {
    const fx = FIXTURES.find((f) => f.id === "clamp")!;
    const good = gradeTests(fx, fx.goldTest);
    expect(good.cleanPass).toBe(true);
    expect(good.survived).toEqual([]); // caught every mutant
    expect(good.good).toBe(true);

    const trivial =
      `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport "./target.mjs";\n` +
      `test("runs", () => assert.ok(true));\n`;
    const weak = gradeTests(fx, trivial);
    expect(weak.cleanPass).toBe(true); // green…
    expect(weak.killRate).toBe(0); // …but catches nothing
    expect(weak.good).toBe(false); // so it's graded not-good
  });
});

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadAgent } from "../src/agents/loader";
import { FIXTURES, gradeReview, numberedCode } from "../eval/reviewer-fixtures";

describe("Phase 4 — reviewer agent", () => {
  it("loads with a read-only inspection toolset and is delegable", () => {
    const spec = loadAgent(resolve("agents/reviewer.md"));
    expect(spec.name).toBe("reviewer");
    expect(spec.delegable).toBe(true);
    // Inspection + optional verification; never mutates code.
    expect(spec.tools).toEqual(expect.arrayContaining(["read", "grep", "glob", "bash"]));
    expect(spec.tools).not.toContain("write");
    expect(spec.tools).not.toContain("edit");
  });

  it("numbers code lines 1-based for citations", () => {
    expect(numberedCode("a\nb")).toBe("  1  a\n  2  b");
  });
});

describe("Phase 4 — reviewer grader", () => {
  const defectFixtures = FIXTURES.filter((f) => !f.clean);
  const clean = FIXTURES.find((f) => f.clean)!;

  it("credits a defect only when an accepted signature term appears", () => {
    const f = FIXTURES.find((x) => x.id === "sql-injection")!;
    expect(gradeReview(f, "- [BLOCKER] x:2 — SQL injection risk.").caught).toEqual(["sql-injection"]);
    expect(gradeReview(f, "Looks fine.").caught).toEqual([]);
  });

  it("scores a perfect review at full recall on every defect fixture", () => {
    for (const f of defectFixtures) {
      const perfect = f.defects.map((d) => `- [MAJOR] x:${d.line} — ${d.terms[0]}.`).join("\n");
      const g = gradeReview(f, perfect);
      expect(g.recall).toBe(1);
      expect(g.missed).toEqual([]);
    }
  });

  it("flags a false BLOCKER/MAJOR on the clean control as a false positive", () => {
    expect(gradeReview(clean, "All correct.\nVERDICT: APPROVE").recall).toBe(1);
    const bad = gradeReview(clean, "- [BLOCKER] x:2 — invented.\nVERDICT: BLOCK");
    expect(bad.falseBlockers).toBe(1);
    expect(bad.recall).toBe(0);
  });

  it("parses the verdict token", () => {
    expect(gradeReview(defectFixtures[0]!, "VERDICT: REQUEST CHANGES — fix it.").verdict).toBe("REQUEST CHANGES");
  });
});

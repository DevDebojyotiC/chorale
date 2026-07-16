import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadAgent } from "../src/agents/loader";
import { FIXTURES, RAMP, gradeReview, numberedCode } from "../eval/reviewer-fixtures";

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

describe("Phase 4 — reviewer difficulty ramp", () => {
  it("has 10 contiguous levels, each with one defect keyed to signature terms", () => {
    expect(RAMP).toHaveLength(10);
    const levels = RAMP.map((f) => f.level).sort((a, b) => a! - b!);
    expect(levels).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const f of RAMP) {
      expect(f.defects).toHaveLength(1);
      expect(f.defects[0]!.terms.length).toBeGreaterThan(0);
    }
  });

  it("a perfect review catches every ramp level; an empty one none", () => {
    for (const f of RAMP) {
      const perfect = `- [MAJOR] ${f.id}:${f.defects[0]!.line} — ${f.defects[0]!.terms[0]}.`;
      expect(gradeReview(f, perfect).caught).toHaveLength(1);
      expect(gradeReview(f, "Looks correct.").caught).toHaveLength(0);
    }
  });
});

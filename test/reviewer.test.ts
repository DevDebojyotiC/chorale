import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadAgent } from "../src/agents/loader";
import { securityClassesIn } from "../src/core/runtime";
import { FIXTURES, RAMP, gradeReview, numberedCode } from "../eval/reviewer-fixtures";
import { PRECISION, MULTI, POLYGLOT, EXPERT, DIFF, MULTIFILE } from "../eval/reviewer-suites";

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

  it("enables self-critique (its self-heal analog) and few-shot; not the coder loops", () => {
    const spec = loadAgent(resolve("agents/reviewer.md"));
    expect(spec.selfCritique).toBe(true);
    expect(spec.fewShot).toBe(true);
    expect(spec.verify).toBe(false);
    expect(spec.selfHeal).toBe(false);
    // selfCritique is opt-in: agents that don't set it stay off.
    expect(loadAgent(resolve("agents/coder.md")).selfCritique).toBe(false);
  });

  it("wires the review gate into the coder, not the reviewer", () => {
    // The coder gets a semantic second opinion from the reviewer after its code verifies.
    expect(loadAgent(resolve("agents/coder.md")).reviewGate).toBe(true);
    // The reviewer itself does not gate (no recursion) and neither do other agents.
    expect(loadAgent(resolve("agents/reviewer.md")).reviewGate).toBe(false);
    expect(loadAgent(resolve("agents/research.md")).reviewGate).toBe(false);
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

describe("Phase 4 — reviewer suites (precision / multi / polyglot / expert)", () => {
  it("PRECISION fixtures are all clean controls; the rest carry keyed defects", () => {
    expect(PRECISION.length).toBeGreaterThan(0);
    for (const f of PRECISION) {
      expect(f.clean).toBe(true);
      expect(f.defects).toHaveLength(0);
    }
    for (const f of [...MULTI, ...POLYGLOT]) {
      expect(f.defects.length).toBeGreaterThan(0);
      for (const d of f.defects) expect(d.terms.length).toBeGreaterThan(0);
    }
    // EXPERT mixes hard defects with one adversarial clean control.
    expect(EXPERT.some((f) => f.clean)).toBe(true);
    expect(EXPERT.some((f) => f.defects.length > 0)).toBe(true);
    // DIFF fixtures are unified diffs (regressions + one correct-change control).
    expect(DIFF.length).toBeGreaterThan(0);
    for (const f of DIFF) {
      expect(f.lang).toBe("diff");
      expect(f.code).toContain("@@");
    }
    expect(DIFF.some((f) => f.clean)).toBe(true);
    // MULTIFILE fixtures are tiny projects (≥2 files) with cross-contract defects + a clean control.
    expect(MULTIFILE.length).toBeGreaterThan(0);
    for (const f of MULTIFILE) expect(Object.keys(f.files).length).toBeGreaterThanOrEqual(2);
    expect(MULTIFILE.some((f) => f.clean)).toBe(true);
    expect(MULTIFILE.some((f) => f.defects.length > 0)).toBe(true);
  });

  it("a clean fixture with a bogus BLOCKER is scored as a false positive", () => {
    const clean = PRECISION[0]!;
    expect(gradeReview(clean, "All good.\nVERDICT: APPROVE").falseBlockers).toBe(0);
    expect(gradeReview(clean, "- [BLOCKER] x:1 — nope.").falseBlockers).toBe(1);
  });
});

describe("Phase 4 — reviewer self-learn (security-class detection)", () => {
  it("detects named security classes for the critique → lesson signal", () => {
    expect(securityClassesIn("This is a clear SSRF via server-side request forgery.").has("sec-ssrf")).toBe(true);
    expect(securityClassesIn("The signature is not verified, so the token is forgeable.").has("sec-verify")).toBe(true);
    expect(securityClassesIn("Looks fine, nicely done.").size).toBe(0);
  });
});

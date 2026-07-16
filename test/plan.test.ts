import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizePlan, parsePlan, assessComplexity, validatePlan, planFeedback, formatPlan } from "../src/core/plan";

describe("Phase 4 — planning core (plan.ts)", () => {
  describe("normalizePlan (structured tool path)", () => {
    it("assigns canonical ids and maps numeric depends references", () => {
      const plan = normalizePlan({
        summary: "Build a library app",
        steps: [
          { title: "DB schema", agent: "Coder", layer: "schema" },
          { title: "API", agent: "coder", layer: "api", dependsOn: [1] },
          { title: "UI", agent: "coder", layer: "ui", dependsOn: ["s2"] },
        ],
      });
      expect(plan.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
      expect(plan.steps[1]!.dependsOn).toEqual(["s1"]); // numeric 1 → s1
      expect(plan.steps[2]!.dependsOn).toEqual(["s2"]); // "s2" kept
      expect(plan.steps[0]!.agent).toBe("coder"); // lower-cased
    });

    it("preserves an unresolvable dependency reference so the validator can flag it (not silently dropped)", () => {
      const plan = normalizePlan({ summary: "x", steps: [{ title: "only", agent: "coder", dependsOn: [5, "the schema"] }] });
      expect(plan.steps[0]!.dependsOn).toEqual(["s5", "the schema"]); // kept as dangling refs, not dropped
    });
  });

  describe("assessComplexity (Approach B — measured, not guessed)", () => {
    const step = (over: Record<string, unknown> = {}) => ({ title: "t", agent: "coder", layer: "api", ...over });

    it("a single one-agent one-layer step is trivial", () => {
      const plan = normalizePlan({ summary: "add pagination", steps: [step({ layer: "api" })] });
      expect(assessComplexity(plan).complexity).toBe("trivial");
    });

    it("3+ steps is complex", () => {
      const plan = normalizePlan({ summary: "x", steps: [step(), step(), step()] });
      expect(assessComplexity(plan).complexity).toBe("complex");
    });

    it("2+ distinct specialists is complex", () => {
      const plan = normalizePlan({ summary: "x", steps: [step({ agent: "coder" }), step({ agent: "scribe" })] });
      const r = assessComplexity(plan);
      expect(r.complexity).toBe("complex");
      expect(r.reasons.join()).toMatch(/specialists/);
    });

    it("2+ architectural layers is complex", () => {
      const plan = normalizePlan({ summary: "x", steps: [step({ layer: "schema" }), step({ layer: "api" })] });
      expect(assessComplexity(plan).complexity).toBe("complex");
    });

    it("a design-decision step is complex even if small", () => {
      const plan = normalizePlan({ summary: "x", steps: [step({ designDecision: true })] });
      expect(assessComplexity(plan).complexity).toBe("complex");
    });
  });

  describe("validatePlan", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "chorale-plan-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const agents = ["coder", "scribe", "research", "reviewer", "test-writer"];

    it("passes a well-formed, grounded plan", () => {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "db.ts"), "export {}");
      const plan = normalizePlan({
        summary: "x",
        steps: [
          { title: "schema", agent: "coder", layer: "schema", acceptance: "tables + migration exist", files: [{ path: "src/db.ts", status: "existing" }] },
          { title: "api", agent: "coder", layer: "api", dependsOn: [1], acceptance: "endpoints return 200/404", files: [{ path: "src/api.ts", status: "new" }] },
        ],
      });
      expect(validatePlan(plan, { agents, cwd: dir })).toEqual([]);
    });

    it("flags a step with no acceptance criterion", () => {
      const plan = normalizePlan({ summary: "x", steps: [{ title: "t", agent: "coder", acceptance: "" }] });
      expect(validatePlan(plan, { agents, cwd: dir }).some((i) => i.kind === "missing-acceptance")).toBe(true);
    });

    it("flags a new file that already exists (mislabel/clobber guard)", () => {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "exists.ts"), "export {}");
      const plan = normalizePlan({ summary: "x", steps: [{ title: "t", agent: "coder", acceptance: "done", files: [{ path: "src/exists.ts", status: "new" }] }] });
      expect(validatePlan(plan, { agents, cwd: dir }).some((i) => i.kind === "new-file-exists")).toBe(true);
    });

    it("does NOT flag reversed order when the catch-all 'other' layer is involved", () => {
      const plan = normalizePlan({
        summary: "x",
        steps: [
          { title: "docs", agent: "scribe", layer: "docs", acceptance: "a" },
          { title: "misc", agent: "coder", layer: "other", acceptance: "b", dependsOn: [1] }, // other→docs would be "reversed" numerically
        ],
      });
      expect(validatePlan(plan, { agents, cwd: dir }).some((i) => i.kind === "ordering")).toBe(false);
    });

    it("flags an unknown specialist", () => {
      const plan = normalizePlan({ summary: "x", steps: [{ title: "t", agent: "wizard" }] });
      const issues = validatePlan(plan, { agents, cwd: dir });
      expect(issues.some((i) => i.kind === "unknown-agent")).toBe(true);
    });

    it("flags a dependency on a non-existent step", () => {
      const plan: any = normalizePlan({ summary: "x", steps: [{ title: "t", agent: "coder" }] });
      plan.steps[0].dependsOn = ["s9"]; // dangling
      expect(validatePlan(plan, { agents, cwd: dir }).some((i) => i.kind === "bad-dependency")).toBe(true);
    });

    it("flags a dependency cycle", () => {
      const plan: any = normalizePlan({ summary: "x", steps: [{ title: "a", agent: "coder" }, { title: "b", agent: "coder" }] });
      plan.steps[0].dependsOn = ["s2"];
      plan.steps[1].dependsOn = ["s1"];
      expect(validatePlan(plan, { agents, cwd: dir }).some((i) => i.kind === "cycle")).toBe(true);
    });

    it("flags reversed build order (schema depending on ui)", () => {
      const plan = normalizePlan({
        summary: "x",
        steps: [{ title: "ui", agent: "coder", layer: "ui" }, { title: "schema", agent: "coder", layer: "schema", dependsOn: [1] }],
      });
      expect(validatePlan(plan, { agents, cwd: dir }).some((i) => i.kind === "ordering")).toBe(true);
    });

    it("flags an ungrounded existing-file reference", () => {
      const plan = normalizePlan({ summary: "x", steps: [{ title: "t", agent: "coder", files: [{ path: "nope/gone.ts", status: "existing" }] }] });
      expect(validatePlan(plan, { agents, cwd: dir }).some((i) => i.kind === "ungrounded")).toBe(true);
    });

    it("does NOT flag an existing-file ref when an earlier step creates it (the grand-tour false positive)", () => {
      const plan = normalizePlan({
        summary: "x",
        steps: [
          { title: "build the script", agent: "coder", layer: "api", acceptance: "runs", files: [{ path: "app.js", status: "new" }] },
          { title: "review the script", agent: "reviewer", layer: "other", dependsOn: [1], acceptance: "reviewed", files: [{ path: "app.js", status: "existing" }] }, // exists by now
        ],
      });
      // app.js doesn't exist on disk, but step 1 creates it — so step 2's `existing` ref is grounded
      expect(validatePlan(plan, { agents, cwd: dir }).some((i) => i.kind === "ungrounded")).toBe(false);
    });

    it("planFeedback lists the issues for a repair round", () => {
      const plan = normalizePlan({ summary: "x", steps: [{ title: "t", agent: "wizard" }] });
      const fb = planFeedback(validatePlan(plan, { agents, cwd: dir }));
      expect(fb).toMatch(/wizard/);
      expect(fb).toMatch(/re-emit/i);
    });
  });

  describe("parsePlan (Markdown fallback)", () => {
    it("parses numbered steps with agent tags, layers, depends and accept lines", () => {
      const text = [
        "Summary: Build a library management app",
        "",
        "1. [coder] Create the database schema (schema)",
        "   depends: none",
        "   accept: books/members/loans tables exist with a migration",
        "   files: src/db.ts (new)",
        "2. [coder] CRUD + checkout endpoints (api)",
        "   depends: 1",
        "   accept: endpoints return correct status codes",
        "3. [test-writer] Tests for the API (tests)",
        "   depends: 2",
      ].join("\n");
      const plan = parsePlan(text)!;
      expect(plan).not.toBeNull();
      expect(plan.summary).toMatch(/library management/i);
      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[0]!.layer).toBe("schema");
      expect(plan.steps[1]!.dependsOn).toEqual(["s1"]);
      expect(plan.steps[2]!.agent).toBe("test-writer");
      expect(assessComplexity(plan).complexity).toBe("complex"); // 3 steps, 2 agents, 3 layers
    });

    it("returns null when there are no recognizable steps", () => {
      expect(parsePlan("just some prose with no steps at all")).toBeNull();
    });

    it("does not force a design decision just because a title contains 'design'", () => {
      const plan = parsePlan("1. [coder] Design the login screen (ui)\n   accept: it renders")!;
      expect(plan.steps[0]!.designDecision).toBe(false); // ordinary build work
    });

    it("marks a genuine design decision (a technical choice)", () => {
      const plan = parsePlan("1. [coder] Choose between REST and GraphQL (api)\n   accept: decided")!;
      expect(plan.steps[0]!.designDecision).toBe(true);
    });
  });

  describe("formatPlan (pre-gate injection)", () => {
    it("renders an ordered checklist with agents, deps, files, and acceptance", () => {
      const plan = normalizePlan({
        summary: "Build it",
        steps: [
          { title: "schema", agent: "coder", layer: "schema", acceptance: "tables exist", files: [{ path: "db.ts", status: "new" }] },
          { title: "api", agent: "coder", layer: "api", dependsOn: [1], acceptance: "returns 200" },
        ],
      });
      const out = formatPlan(plan);
      expect(out).toMatch(/Build it/); // summary
      expect(out).toMatch(/1\. \[coder\] schema \[schema\]/);
      expect(out).toMatch(/db\.ts \(new\)/);
      expect(out).toMatch(/2\. \[coder\] api \[api\] \(after #1\)/); // dependency rendered as step number
      expect(out).toMatch(/done when: returns 200/);
    });
  });
});

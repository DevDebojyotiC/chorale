/**
 * Planner benchmark fixtures + graders. A plan isn't "executed", so we grade it on objective,
 * checkable properties — the planner's version of execution-grading:
 *   - COMPLEXITY: does assessComplexity classify the request right (plan vs proceed-inline)?
 *   - COMPLETENESS: are the required architectural layers all covered?
 *   - DELEGATION: are the required specialists used, and no unknown agent assigned?
 *   - STRUCTURE: does validatePlan pass (acyclic DAG, sane order, grounded files, acceptance)?
 * Graders are pure + self-validated by planner-selftest.ts (no model calls). The live harness
 * (planner-bench.ts) runs the actual planner and grades its output with these same functions.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { normalizePlan, assessComplexity, validatePlan, type Plan, type PlanLayer } from "../src/core/plan.js";

export interface FileMap {
  [path: string]: string;
}

/** A step in a hand-authored gold plan (the normalizePlan input shape). */
export interface GoldStep {
  title: string;
  agent: string;
  layer?: string;
  dependsOn?: (string | number)[];
  acceptance?: string;
  files?: { path: string; status?: "existing" | "new" }[];
  designDecision?: boolean;
}

export interface PlanFixture {
  id: string;
  goal: string;
  /** Gold plan/no-plan label — read from the decomposition (Approach B). */
  expectComplexity: "complex" | "trivial";
  /** Architectural layers a correct plan must cover (completeness). */
  requiredLayers: PlanLayer[];
  /** Specialists a correct plan must use (delegation). */
  requiredAgents: string[];
  /** A synthetic repo the plan grounds against — `existing` files must be here; `new` must not. */
  repo: FileMap;
  /** A hand-authored correct plan — used by the self-test as the oracle. */
  gold: { summary: string; steps: GoldStep[] };
}

/** The specialists a plan may currently assign to (existing, delegable agents). */
export const ROSTER = ["coder", "scribe", "research", "reviewer"];

export const FIXTURES: PlanFixture[] = [
  {
    id: "fullstack-lib",
    goal: "Build a small library management app: catalog books, register members, and check books in and out.",
    expectComplexity: "complex",
    requiredLayers: ["schema", "api", "ui", "tests", "docs"],
    requiredAgents: ["coder", "scribe"],
    repo: { "package.json": JSON.stringify({ name: "library", version: "0.1.0" }, null, 2) + "\n" },
    gold: {
      summary: "Build a library management app (catalog, members, checkout).",
      steps: [
        { title: "Design the data model", agent: "coder", layer: "schema", acceptance: "books/members/loans tables + a migration exist", files: [{ path: "src/db/schema.ts", status: "new" }] },
        { title: "CRUD + checkout/return endpoints", agent: "coder", layer: "api", dependsOn: [1], acceptance: "endpoints return correct status codes; checkout decrements availability", files: [{ path: "src/api/index.ts", status: "new" }] },
        { title: "Catalog + loan UI", agent: "coder", layer: "ui", dependsOn: [2], acceptance: "list, search and checkout screens render and call the API", files: [{ path: "src/ui/App.tsx", status: "new" }] },
        { title: "API tests", agent: "coder", layer: "tests", dependsOn: [2], acceptance: "happy-path + edge-case tests pass", files: [{ path: "test/api.test.ts", status: "new" }] },
        { title: "README + setup docs", agent: "scribe", layer: "docs", dependsOn: [2], acceptance: "README documents setup and the API", files: [{ path: "README.md", status: "new" }] },
      ],
    },
  },
  {
    id: "add-endpoint",
    goal: "Add a paginated GET /users endpoint to the existing API, and document it.",
    expectComplexity: "complex", // two specialists (coder + scribe) → worth a plan
    requiredLayers: ["api", "docs"],
    requiredAgents: ["coder", "scribe"],
    repo: { "src/api/users.ts": "export function listUsers() { return []; }\n", "docs/api.md": "# API\n" },
    gold: {
      summary: "Paginate GET /users and document it.",
      steps: [
        { title: "Add pagination to GET /users", agent: "coder", layer: "api", acceptance: "accepts page/limit; returns 400 on a bad cursor", files: [{ path: "src/api/users.ts", status: "existing" }] },
        { title: "Document the endpoint", agent: "scribe", layer: "docs", dependsOn: [1], acceptance: "docs/api.md describes the page/limit params", files: [{ path: "docs/api.md", status: "existing" }] },
      ],
    },
  },
  {
    id: "typo-fix",
    goal: "Fix the typo in the README heading.",
    expectComplexity: "trivial", // one small step — proceed inline, no formal plan
    requiredLayers: ["docs"],
    requiredAgents: ["scribe"],
    repo: { "README.md": "# Hedaing\n\nWelcome.\n" },
    gold: {
      summary: "Fix the README heading typo.",
      steps: [{ title: "Correct the heading spelling", agent: "scribe", layer: "docs", acceptance: "the heading reads 'Heading'", files: [{ path: "README.md", status: "existing" }] }],
    },
  },
  {
    id: "oauth",
    goal: "Add Google OAuth login across the app — decide where auth state lives, then implement it.",
    expectComplexity: "complex", // an up-front design decision
    requiredLayers: ["api", "ui", "tests"],
    requiredAgents: ["coder"],
    repo: { "package.json": JSON.stringify({ name: "app", version: "0.1.0" }, null, 2) + "\n", "src/api/index.ts": "export const app = {};\n" },
    gold: {
      summary: "Add Google OAuth login, deciding the auth-state approach first.",
      steps: [
        { title: "Decide between session and JWT auth (trade-off)", agent: "coder", layer: "api", designDecision: true, acceptance: "approach chosen and written down with rationale", files: [] },
        { title: "Implement OAuth login + callback endpoints", agent: "coder", layer: "api", dependsOn: [1], acceptance: "login and callback endpoints complete the OAuth flow", files: [{ path: "src/api/auth.ts", status: "new" }] },
        { title: "Add the login UI", agent: "coder", layer: "ui", dependsOn: [2], acceptance: "a login button starts the flow and redirects back signed in", files: [{ path: "src/ui/Login.tsx", status: "new" }] },
        { title: "Auth flow tests", agent: "coder", layer: "tests", dependsOn: [2], acceptance: "the OAuth flow is covered by passing tests", files: [{ path: "test/auth.test.ts", status: "new" }] },
      ],
    },
  },
];

export interface PlanGrade {
  id: string;
  complexityOk: boolean;
  completeness: number; // 0..1 — fraction of required layers covered
  delegationOk: boolean;
  structureOk: boolean;
  issues: number;
  pass: boolean;
}

/** Grade a plan against a fixture's gold expectations (pure — no model calls). */
export function gradePlan(fx: PlanFixture, plan: Plan, opts: { cwd: string }): PlanGrade {
  const complexityOk = assessComplexity(plan).complexity === fx.expectComplexity;
  const layers = new Set(plan.steps.map((s) => s.layer));
  const covered = fx.requiredLayers.filter((l) => layers.has(l)).length;
  const completeness = fx.requiredLayers.length === 0 ? 1 : covered / fx.requiredLayers.length;
  const agents = new Set(plan.steps.map((s) => s.agent));
  const issues = validatePlan(plan, { agents: ROSTER, cwd: opts.cwd });
  const delegationOk = fx.requiredAgents.every((a) => agents.has(a)) && !issues.some((i) => i.kind === "unknown-agent");
  const structureOk = issues.length === 0;
  const pass = complexityOk && completeness === 1 && delegationOk && structureOk;
  return { id: fx.id, complexityOk, completeness, delegationOk, structureOk, issues: issues.length, pass };
}

/** Materialize a fixture's synthetic repo under `dir` so grounding checks can see the files. */
export function writeRepo(dir: string, files: FileMap): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = resolve(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
}

/** Convenience for the self-test: normalize a fixture's gold plan into a canonical Plan. */
export function goldPlan(fx: PlanFixture): Plan {
  return normalizePlan(fx.gold);
}

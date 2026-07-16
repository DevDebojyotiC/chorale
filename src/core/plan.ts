/**
 * Planning core — the deterministic half of the Planner/Architect (Task 3, Phase B).
 *
 * The planner *agent* (an LLM) decomposes a request into steps; this module provides the
 * trustworthy scaffolding around that: a canonical Plan shape, a structured tool schema
 * (the preferred output path), a tolerant Markdown parser (the fallback when a weak model
 * emits the plan as text), a deterministic complexity measure (Approach B — decide "worth
 * planning?" from the decomposition, not from the raw request), and a validator that checks
 * assignments, the dependency DAG, ordering sanity, and grounding against the real repo.
 *
 * Nothing here calls a model, so it is fully unit-testable and the benchmark graders are
 * self-validating.
 */

import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** The architectural layers a step can belong to (used for the complexity measure). */
export const PLAN_LAYERS = ["schema", "api", "ui", "tests", "docs", "infra", "other"] as const;
export type PlanLayer = (typeof PLAN_LAYERS)[number];

export interface PlanFile {
  path: string;
  /** `existing` files are grounded (must exist); `new` files are legitimately to-be-created. */
  status: "existing" | "new";
}

export interface PlanStep {
  id: string;
  title: string;
  /** The specialist assigned to this step (e.g. coder, scribe, research, test-writer, reviewer). */
  agent: string;
  /** Ids of prerequisite steps — the edges of the plan DAG. */
  dependsOn: string[];
  layer: PlanLayer;
  /** What "done" looks like for this step (a checkable criterion). */
  acceptance: string;
  /** Files the step touches, each marked existing (grounded) or new. */
  files: PlanFile[];
  /** True when the step requires an up-front technical/design decision (bumps complexity). */
  designDecision: boolean;
}

export interface Plan {
  summary: string;
  steps: PlanStep[];
  /** Computed, never model-claimed — see assessComplexity. */
  complexity: "trivial" | "complex";
}

// ── Structured tool schema (the preferred output path) ────────────────────────

/** Zod schema for the `plan` tool. Loose on optionals so a model retry isn't triggered by
 *  a missing acceptance line; normalizePlan fills the gaps. */
export const PLAN_TOOL_SCHEMA = z.object({
  summary: z.string().describe("One-line summary of the goal"),
  steps: z
    .array(
      z.object({
        title: z.string().describe("Short imperative step title"),
        agent: z.string().describe("Specialist to do this step (coder, scribe, research, test-writer, reviewer)"),
        dependsOn: z.array(z.union([z.string(), z.number()])).optional().describe("Step numbers/ids this depends on"),
        layer: z.string().optional().describe("schema | api | ui | tests | docs | infra | other"),
        acceptance: z.string().optional().describe("What 'done' looks like for this step"),
        files: z
          .array(z.object({ path: z.string(), status: z.enum(["existing", "new"]).optional() }))
          .optional()
          .describe("Files this step touches, each marked existing or new"),
        designDecision: z.boolean().optional().describe("True if this step needs an up-front design decision"),
      }),
    )
    .describe("Ordered decomposition of the goal"),
});

type RawStep = {
  title?: unknown;
  agent?: unknown;
  dependsOn?: unknown;
  layer?: unknown;
  acceptance?: unknown;
  files?: unknown;
  designDecision?: unknown;
};

const asLayer = (v: unknown): PlanLayer => {
  const s = String(v ?? "").toLowerCase();
  return (PLAN_LAYERS as readonly string[]).includes(s) ? (s as PlanLayer) : "other";
};

/** Normalize loosely-typed structured input (from the plan tool) into a canonical Plan. */
export function normalizePlan(input: { summary?: unknown; steps?: unknown }): Plan {
  const rawSteps: RawStep[] = Array.isArray(input.steps) ? (input.steps as RawStep[]) : [];
  // Assign canonical ids s1..sN by order; map any numeric/loose depends references onto them.
  const idFor = (i: number): string => `s${i + 1}`;
  const refToId = (ref: unknown): string | null => {
    const s = String(ref ?? "").trim().replace(/^#/, "");
    const asNum = s.match(/^s?(\d+)$/i);
    if (asNum) {
      const n = parseInt(asNum[1]!, 10);
      return n >= 1 && n <= rawSteps.length ? idFor(n - 1) : null;
    }
    return null;
  };
  const steps: PlanStep[] = rawSteps.map((r, i) => ({
    id: idFor(i),
    title: String(r.title ?? "").trim() || `Step ${i + 1}`,
    agent: String(r.agent ?? "").trim().toLowerCase() || "coder",
    dependsOn: (Array.isArray(r.dependsOn) ? r.dependsOn : []).map(refToId).filter((x): x is string => x !== null),
    layer: asLayer(r.layer),
    acceptance: String(r.acceptance ?? "").trim(),
    files: (Array.isArray(r.files) ? (r.files as { path?: unknown; status?: unknown }[]) : [])
      .map((f) => ({ path: String(f.path ?? "").trim(), status: f.status === "existing" ? ("existing" as const) : ("new" as const) }))
      .filter((f) => f.path.length > 0),
    designDecision: r.designDecision === true,
  }));
  const plan: Plan = { summary: String(input.summary ?? "").trim(), steps, complexity: "trivial" };
  plan.complexity = assessComplexity(plan).complexity;
  return plan;
}

// ── Tolerant Markdown fallback parser ─────────────────────────────────────────

/**
 * Best-effort parse of a plan a model wrote as text (the fallback when it didn't call the
 * tool). Recognizes numbered/bulleted steps of the shape:
 *   1. [coder] Create the schema (schema)
 *      depends: none · accept: … · files: a.ts (new)
 * Tolerant of missing sub-lines and minor format drift. Returns null if no steps are found.
 */
export function parsePlan(text: string): Plan | null {
  const lines = text.split(/\r?\n/);
  const summaryMatch = text.match(/^\s*(?:##\s*)?(?:summary|goal)\s*[:\-]\s*(.+)$/im);
  const summary = summaryMatch ? summaryMatch[1]!.trim() : "";

  type Acc = { title: string; agent: string; layer: string; depends: string[]; accept: string; files: PlanFile[]; design: boolean };
  const accs: Acc[] = [];
  const stepHead = /^\s*(?:\d+[.)]|[-*])\s*(?:\[([a-zA-Z-]+)\]|@([a-zA-Z-]+)|\(([a-zA-Z-]+)\))?\s*(.*)$/;

  const parseSub = (acc: Acc, line: string): boolean => {
    const dep = line.match(/^\s*(?:depends?|deps?|after)\s*[:\-]\s*(.+)$/i);
    if (dep) {
      acc.depends = /none|-|n\/a/i.test(dep[1]!.trim()) ? [] : dep[1]!.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      return true;
    }
    const acc2 = line.match(/^\s*(?:accept|acceptance|done|dod)\s*[:\-]\s*(.+)$/i);
    if (acc2) {
      acc.accept = acc2[1]!.trim();
      return true;
    }
    const files = line.match(/^\s*files?\s*[:\-]\s*(.+)$/i);
    if (files) {
      acc.files = files[1]!.split(/[,;]/).map((s) => s.trim()).filter(Boolean).map((tok) => {
        const m = tok.match(/^(.+?)\s*\((new|existing)\)\s*$/i);
        return m ? { path: m[1]!.trim(), status: m[2]!.toLowerCase() as "existing" | "new" } : { path: tok, status: "new" as const };
      });
      return true;
    }
    return false;
  };

  let cur: Acc | null = null;
  for (const line of lines) {
    const head = line.match(stepHead);
    // A head line must actually look like a step (has an agent tag or a leading number/bullet + text).
    if (head && /^\s*(?:\d+[.)]|[-*])/.test(line) && (head[1] || head[2] || head[3] || head[4])) {
      // But don't treat a sub-line ("- depends: …") as a new step.
      if (cur && parseSub(cur, line)) continue;
      const agent = (head[1] || head[2] || head[3] || "").toLowerCase();
      let rest = (head[4] || "").trim();
      let layer = "other";
      const layerTail = rest.match(/\(([a-zA-Z]+)\)\s*$/);
      if (layerTail && (PLAN_LAYERS as readonly string[]).includes(layerTail[1]!.toLowerCase())) {
        layer = layerTail[1]!.toLowerCase();
        rest = rest.slice(0, layerTail.index).trim();
      }
      cur = { title: rest, agent, layer, depends: [], accept: "", files: [], design: /design|architect|decision/i.test(rest) };
      accs.push(cur);
      continue;
    }
    if (cur && parseSub(cur, line)) continue;
  }
  if (accs.length === 0) return null;

  return normalizePlan({
    summary,
    steps: accs.map((a) => ({
      title: a.title,
      agent: a.agent,
      dependsOn: a.depends,
      layer: a.layer,
      acceptance: a.accept,
      files: a.files,
      designDecision: a.design,
    })),
  });
}

// ── Complexity (Approach B) ───────────────────────────────────────────────────

export interface ComplexityResult {
  complexity: "trivial" | "complex";
  reasons: string[];
}

/**
 * Decide whether a decomposition is worth a formal plan — read from the plan itself, not the
 * raw request. Complex if ≥3 steps, or ≥2 distinct specialists, or ≥2 architectural layers,
 * or any step needs a design decision. Otherwise trivial (the caller just proceeds inline).
 */
export function assessComplexity(plan: Plan): ComplexityResult {
  const reasons: string[] = [];
  const distinctAgents = new Set(plan.steps.map((s) => s.agent)).size;
  const distinctLayers = new Set(plan.steps.map((s) => s.layer).filter((l) => l !== "other")).size;
  if (plan.steps.length >= 3) reasons.push(`${plan.steps.length} steps`);
  if (distinctAgents >= 2) reasons.push(`${distinctAgents} specialists`);
  if (distinctLayers >= 2) reasons.push(`${distinctLayers} layers`);
  if (plan.steps.some((s) => s.designDecision)) reasons.push("design decision");
  return { complexity: reasons.length > 0 ? "complex" : "trivial", reasons };
}

// ── Validation (assignments, DAG, ordering, grounding) ────────────────────────

export interface PlanIssue {
  kind: "unknown-agent" | "bad-dependency" | "cycle" | "ordering" | "ungrounded" | "empty";
  step?: string;
  message: string;
}

// A rough layer precedence for the ordering sanity check: earlier layers should not depend on later ones.
const LAYER_ORDER: Record<PlanLayer, number> = { schema: 0, api: 1, ui: 2, tests: 3, docs: 3, infra: 0, other: 2 };

/** Detect a cycle in the dependency graph via DFS; returns true if any cycle exists. */
function hasCycle(plan: Plan): boolean {
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  const state = new Map<string, 0 | 1 | 2>(); // 0/undef=unseen, 1=in-stack, 2=done
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dep) && visit(dep)) return true;
    }
    state.set(id, 2);
    return false;
  };
  return plan.steps.some((s) => visit(s.id));
}

/**
 * Validate a plan deterministically: every agent is a known specialist, dependencies point at
 * real steps and are acyclic, ordering is sane (a step shouldn't depend on a strictly-later
 * layer), and `existing` file references are grounded in the repo. Returns the issues to fix.
 */
export function validatePlan(plan: Plan, opts: { agents: string[]; cwd: string }): PlanIssue[] {
  const issues: PlanIssue[] = [];
  if (plan.steps.length === 0) {
    issues.push({ kind: "empty", message: "The plan has no steps." });
    return issues;
  }
  const ids = new Set(plan.steps.map((s) => s.id));
  const known = new Set(opts.agents.map((a) => a.toLowerCase()));
  for (const s of plan.steps) {
    if (known.size > 0 && !known.has(s.agent)) {
      issues.push({ kind: "unknown-agent", step: s.id, message: `Step ${s.id} is assigned to "${s.agent}", which is not an available specialist (${opts.agents.join(", ")}).` });
    }
    for (const dep of s.dependsOn) {
      if (!ids.has(dep)) {
        issues.push({ kind: "bad-dependency", step: s.id, message: `Step ${s.id} depends on "${dep}", which is not a step in the plan.` });
      } else {
        const from = plan.steps.find((x) => x.id === dep)!;
        if (LAYER_ORDER[s.layer] < LAYER_ORDER[from.layer]) {
          issues.push({ kind: "ordering", step: s.id, message: `Step ${s.id} (${s.layer}) depends on ${dep} (${from.layer}) — that reverses the usual build order.` });
        }
      }
    }
    for (const f of s.files) {
      if (f.status === "existing" && !existsSync(resolve(opts.cwd, f.path))) {
        issues.push({ kind: "ungrounded", step: s.id, message: `Step ${s.id} references existing file "${f.path}", which does not exist in the repo.` });
      }
    }
  }
  if (hasCycle(plan)) issues.push({ kind: "cycle", message: "The plan's dependencies contain a cycle." });
  return issues;
}

/** Turn validation issues into a feedback message for a repair round. */
export function planFeedback(issues: PlanIssue[]): string {
  if (issues.length === 0) return "";
  return (
    "The plan has these problems — revise it and re-emit the whole plan:\n" +
    issues.map((i) => `- ${i.message}`).join("\n") +
    "\nKeep the parts that were fine; only fix the flagged issues."
  );
}

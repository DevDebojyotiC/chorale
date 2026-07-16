/**
 * Plan execution (Phase 4 · fullstack capability · lever #1).
 *
 * The orchestrator used to "execute" a plan by delegating steps freely inside ONE model turn —
 * which overflows its step/context budget on a big plan and stops partway (the fullstack experiment
 * built a backend and never reached the frontend). This module makes a plan an *executed program*:
 * every step runs, in dependency order, each delegated to its assigned specialist, with a running
 * summary of completed steps threaded forward so later steps build on the earlier ones (a lightweight
 * shared project contract). Nothing here calls a model directly — the runner is injected — so the
 * ordering/threading logic is fully unit-testable.
 */

import type { Plan, PlanStep } from "./plan.js";

/**
 * Order steps so each comes after its dependencies (a stable topological sort: input order breaks
 * ties, dangling deps are ignored, and any cycle-involved leftovers are appended in input order —
 * validatePlan already rejects cycles upstream).
 */
export function orderSteps(plan: Plan): PlanStep[] {
  const ids = new Set(plan.steps.map((s) => s.id));
  const done = new Set<string>();
  const out: PlanStep[] = [];
  let progress = true;
  while (out.length < plan.steps.length && progress) {
    progress = false;
    for (const s of plan.steps) {
      if (done.has(s.id)) continue;
      const deps = s.dependsOn.filter((d) => ids.has(d)); // ignore refs to steps not in the plan
      if (deps.every((d) => done.has(d))) {
        out.push(s);
        done.add(s.id);
        progress = true;
      }
    }
  }
  for (const s of plan.steps) if (!done.has(s.id)) out.push(s); // cyclic leftovers, in input order
  return out;
}

/** A compact, self-contained summary of a finished step, threaded into later steps' tasks. */
export function summarizeStep(step: PlanStep, resultText: string): string {
  const files = step.files.length ? ` (files: ${step.files.map((f) => f.path).join(", ")})` : "";
  const gist = resultText.replace(/\s+/g, " ").trim().slice(0, 220);
  return `${step.id} [${step.agent}] ${step.title}${files}${gist ? ` — ${gist}` : ""}`;
}

/**
 * Build the delegation task for a single step. The specialist can't see the conversation, so the
 * task is self-contained: the overall goal, a summary of what earlier steps produced (so it matches
 * their file paths / names / API contracts), and this step's own title, acceptance, and files.
 */
export function stepTask(step: PlanStep, priorSummaries: string[], goal: string): string {
  const parts: string[] = [`You are building ONE step of a larger project. Overall goal: ${goal}`];
  if (priorSummaries.length) {
    parts.push(
      "\nAlready completed — build ON these and stay consistent with their file paths, names, routes, and data shapes:\n" +
        priorSummaries.map((s) => `- ${s}`).join("\n"),
    );
  }
  parts.push(`\nYour step (${step.id}): ${step.title}`);
  if (step.acceptance) parts.push(`Done when: ${step.acceptance}`);
  if (step.files.length) parts.push(`Files to create/edit: ${step.files.map((f) => `${f.path} (${f.status})`).join(", ")}`);
  parts.push("\nComplete this step now, end to end. Do not redo earlier steps; extend them coherently.");
  return parts.join("\n");
}

export interface StepResult {
  id: string;
  agent: string;
  title: string;
  ok: boolean;
  text: string;
}

/** Runs one specialist on a self-contained task. Injected by the runtime (wraps runAgent). */
export type StepRunner = (agentName: string, task: string, step: PlanStep) => Promise<{ ok: boolean; text: string }>;

export interface ExecuteOptions {
  goal?: string;
  /** Notified as each step finishes (for progress logging). */
  onStep?: (result: StepResult, index: number, total: number) => void;
}

/**
 * Execute an entire plan: every step, in dependency order, delegated to its assigned specialist,
 * with a running summary of completed steps threaded into each subsequent task. Returns each step's
 * result. A step whose runner throws/fails is recorded (ok:false) and execution continues — one
 * failed step shouldn't abandon the rest of the build.
 */
export async function executePlan(plan: Plan, run: StepRunner, opts: ExecuteOptions = {}): Promise<StepResult[]> {
  const ordered = orderSteps(plan);
  const goal = opts.goal ?? plan.summary;
  const summaries: string[] = [];
  const results: StepResult[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const step = ordered[i]!;
    let sr: StepResult;
    try {
      const r = await run(step.agent, stepTask(step, summaries, goal), step);
      sr = { id: step.id, agent: step.agent, title: step.title, ok: r.ok, text: r.text };
    } catch (e) {
      sr = { id: step.id, agent: step.agent, title: step.title, ok: false, text: e instanceof Error ? e.message : String(e) };
    }
    results.push(sr);
    opts.onStep?.(sr, i, ordered.length);
    summaries.push(summarizeStep(step, sr.text)); // thread forward even on failure (later steps know what happened)
  }
  return results;
}

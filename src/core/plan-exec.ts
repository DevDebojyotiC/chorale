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

export interface StepResult {
  id: string;
  agent: string;
  title: string;
  ok: boolean;
  text: string;
}

/** A compact prose summary of a finished step — the fallback "what happened" context. */
export function summarizeResult(r: StepResult): string {
  const gist = r.text.replace(/\s+/g, " ").trim().slice(0, 200);
  return `${r.id} [${r.agent}] ${r.title}${gist ? ` — ${gist}` : ""}`;
}

/**
 * Build the delegation task for a single step. The specialist can't see the conversation, so the
 * task is self-contained: the overall goal, the `context` of what already exists (real routes/tables/
 * types when the runtime supplies a contract; a prose recap otherwise), and this step's own title,
 * acceptance, and files.
 */
export function stepTask(step: PlanStep, context: string, goal: string): string {
  const parts: string[] = [`You are building ONE step of a larger project (other specialists handle the other steps). Overall goal: ${goal}`];
  if (context.trim()) {
    parts.push(
      "\nWhat already exists — build to MATCH these exact contracts (routes, base URL, table/column names, exported symbols). Do NOT invent different ones, and do NOT recreate existing files:\n" +
        context,
    );
  }
  parts.push(`\nYOUR STEP (${step.id}): ${step.title}`);
  if (step.acceptance) parts.push(`Done when: ${step.acceptance}`);
  if (step.files.length) {
    parts.push(`Create these files by WRITING them (the write tool creates parent folders for you — do NOT run mkdir): ${step.files.map((f) => `${f.path} (${f.status})`).join(", ")}`);
  }
  parts.push("\nImplement this step FULLY and write the actual file contents now with the write tool. Don't just explore, plan, or make directories — produce the working code/files for this step.");
  return parts.join("\n");
}

/** Runs one specialist on a self-contained task. Injected by the runtime (wraps runAgent). */
export type StepRunner = (agentName: string, task: string, step: PlanStep) => Promise<{ ok: boolean; text: string }>;

export interface ExecuteOptions {
  goal?: string;
  /** Notified as each step finishes (for progress logging). */
  onStep?: (result: StepResult, index: number, total: number) => void;
  /**
   * Build the "what already exists" context injected into the NEXT step. Default: a prose recap of
   * completed steps. The runtime injects a version that reads the files built so far and extracts the
   * real project contract (routes/tables/exports) — so e.g. the frontend step gets the backend's
   * actual endpoints, not a guess.
   */
  context?: (completed: StepResult[]) => string | Promise<string>;
}

const defaultContext = (completed: StepResult[]): string => completed.map((r) => `- ${summarizeResult(r)}`).join("\n");

/**
 * Execute an entire plan: every step, in dependency order, delegated to its assigned specialist, with
 * the accumulated project context threaded into each subsequent task. Returns each step's result. A
 * step whose runner throws/fails is recorded (ok:false) and execution continues — one failed step
 * shouldn't abandon the rest of the build.
 */
export async function executePlan(plan: Plan, run: StepRunner, opts: ExecuteOptions = {}): Promise<StepResult[]> {
  const ordered = orderSteps(plan);
  const goal = opts.goal ?? plan.summary;
  const buildContext = opts.context ?? defaultContext;
  const results: StepResult[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const step = ordered[i]!;
    const context = await buildContext(results);
    let sr: StepResult;
    try {
      const r = await run(step.agent, stepTask(step, context, goal), step);
      sr = { id: step.id, agent: step.agent, title: step.title, ok: r.ok, text: r.text };
    } catch (e) {
      sr = { id: step.id, agent: step.agent, title: step.title, ok: false, text: e instanceof Error ? e.message : String(e) };
    }
    results.push(sr);
    opts.onStep?.(sr, i, ordered.length);
  }
  return results;
}

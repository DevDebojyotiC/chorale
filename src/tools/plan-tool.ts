import { tool } from "ai";
import { PLAN_TOOL_SCHEMA, normalizePlan, type Plan } from "../core/plan.js";

/**
 * Build the `plan` tool — the planner's preferred, structured output path. The model calls it
 * once with its decomposition; the tool canonicalizes the input into a Plan and hands it to the
 * runtime via `capture`. (If the model writes the plan as text instead, the runtime falls back
 * to parsing it — see parsePlan.) Returns a short ack so the model knows the plan was received.
 */
export function createPlanTool(ctx: { capture: (plan: Plan) => void }) {
  return tool({
    description:
      "Emit your decomposition as a STRUCTURED plan. Provide an ordered list of steps; for each step give a short title, the specialist agent to do it, the step numbers it depends on, the architectural layer (schema/api/ui/tests/docs/infra/other), an acceptance criterion, and the files it touches (each marked existing or new). " +
      "ALSO fill in `contract` — the interface spec the whole build shares: the exact endpoints (method + full path), each shared module's exports/signatures, the data model, EVERY npm dependency, and the env vars. This is the single source of truth every step is held to, so decide the seams NOW rather than letting each step guess. Call this exactly once, when the plan is complete.",
    inputSchema: PLAN_TOOL_SCHEMA,
    execute: async (input) => {
      const plan = normalizePlan(input);
      ctx.capture(plan);
      return { ok: true, steps: plan.steps.length, complexity: plan.complexity };
    },
  });
}

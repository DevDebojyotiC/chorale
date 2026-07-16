import { tool } from "ai";
import { z } from "zod";

/**
 * Runs an agent as a gate, returning its text or a structured refusal (loop-guarded).
 * Injected by the runtime to avoid an import cycle (it wraps runtime.runGate).
 */
export type GateRunner = (
  agentName: string,
  task: string,
  callerChain: string[],
) => Promise<{ ok: true; text: string } | { ok: false; reason: string }>;

export interface GateToolContext {
  /** On-demand gate agents this caller is permitted to invoke (the allow-list). */
  allowed: string[];
  /** The caller's gate chain (chainWith(callerName)) — used for loop detection. */
  callerChain: string[];
  /** Record an unmet-gate note so it can bubble up on the caller's result (light-2 signal). */
  recordUnmet: (note: string) => void;
  run: GateRunner;
}

/**
 * Build the on-demand `gate` tool: lets an agent invoke a *permitted* other agent as an
 * advisory checking/planning step whose result feeds back into its own work. Unlike
 * `delegate` (hand off a sub-task), a gate is a second opinion and is loop-guarded — a gate
 * to an agent already in the chain is refused. On refusal the caller is told to proceed
 * inline, and the unmet need is recorded so it surfaces on the caller's result (graceful
 * degradation + upward signal).
 */
export function createGateTool(ctx: GateToolContext) {
  return tool({
    description:
      "Run a permitted specialist as a GATE — an advisory checking/planning second opinion whose result feeds back into YOUR work (you stay in charge). Different from delegate, which hands off a whole sub-task. " +
      `Available gates: ${ctx.allowed.join(", ") || "(none)"}. ` +
      "A gate is loop-guarded: if it's refused (e.g. that agent is already in the current chain), you'll get the reason — handle the task inline yourself and mention the unmet need in your result.",
    inputSchema: z.object({
      agent: z.string().describe("The gate agent to invoke (must be one of the available gates)"),
      task: z.string().describe("A clear, self-contained task/question for the gate agent"),
    }),
    execute: async ({ agent, task }) => {
      if (!ctx.allowed.includes(agent)) {
        return { error: `"${agent}" is not an available gate. Available: ${ctx.allowed.join(", ") || "(none)"}.` };
      }
      const r = await ctx.run(agent, task, ctx.callerChain);
      if (!r.ok) {
        ctx.recordUnmet(`${agent}: ${r.reason}`);
        return {
          refused: r.reason,
          guidance: "This gate is unavailable right now. Proceed by handling the task inline yourself, and note the unmet need in your result.",
        };
      }
      return { agent, result: r.text };
    },
  });
}

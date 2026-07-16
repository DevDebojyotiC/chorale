/**
 * Gate loop-prevention. A "gate" runs another agent as a checking/planning step. To make
 * cycles structurally impossible we track the chain of agents currently active in a gate
 * lineage and forbid running any agent that is ALREADY in the chain — so an agent using a
 * gate can never be re-entered further down the chain:
 *
 *   coder → reviewer → planner → researcher → coder   ✋ (coder already in chain → refused)
 *
 * This allows arbitrarily deep chains of DISTINCT agents (a planner gate may consult the
 * researcher) while guaranteeing no loop. A generous depth cap bounds cost as a backstop.
 *
 * The chain travels through the recursive runAgent calls via an env var (the same ambient
 * channel the one-pass guards use), holding the ancestor agents up to but NOT including the
 * agent about to run — each agent appends itself with chainWith().
 */

const CHAIN_ENV = "CHORALE_GATE_CHAIN";

/** Cost backstop: a single gate lineage may be at most this deep (distinct agents). */
export const MAX_GATE_DEPTH = 4;

/** The ancestor chain from the environment (agents already active above the current one). */
export function gateChain(): string[] {
  return (process.env[CHAIN_ENV] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** The active chain including `self` — the currently running agent added to its ancestors. */
export function chainWith(self: string): string[] {
  const c = gateChain();
  return c.includes(self) ? c : [...c, self];
}

export interface GateDecision {
  ok: boolean;
  reason?: string;
}

/**
 * Whether `target` may be run as a gate from within `chain` (which must already include the
 * caller via chainWith). Refuses if globally disabled, if the target is already in the chain
 * (would loop), or if the depth cap is reached.
 */
export function canRunGate(chain: string[], target: string): GateDecision {
  if (process.env.CHORALE_NO_GATES === "1") return { ok: false, reason: "gates disabled (CHORALE_NO_GATES)" };
  if (chain.includes(target)) return { ok: false, reason: `"${target}" is already in the gate chain (${chain.join(" → ")}) — refusing to avoid a loop` };
  if (chain.length >= MAX_GATE_DEPTH) return { ok: false, reason: `gate depth cap ${MAX_GATE_DEPTH} reached (${chain.join(" → ")})` };
  return { ok: true };
}

/**
 * Run `fn` (which invokes the gate's agent) with the chain advanced to `callerChain` — the
 * caller's chainWith(self), i.e. the ancestors including the caller but not yet the target.
 * The target's own runAgent reads this and appends itself. Restores the env afterward.
 */
export async function withGateChain<T>(callerChain: string[], fn: () => Promise<T>): Promise<T> {
  const prev = process.env[CHAIN_ENV];
  process.env[CHAIN_ENV] = callerChain.join(",");
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[CHAIN_ENV];
    else process.env[CHAIN_ENV] = prev;
  }
}

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

/**
 * A gate: another agent this one may run as a checking/planning step (allow-listed).
 * `auto` gates fire deterministically at a lifecycle point; `on-demand` gates are invoked
 * by the agent itself via the `gate()` tool. An agent running AS a gate has its own gates
 * disabled (depth capped at 1), so gates cannot recurse.
 */
export interface GateSpec {
  /** Name of the agent to run as a gate (the allow-list entry). */
  agent: string;
  /** `auto` = runs at a lifecycle point; `on-demand` = the agent calls it via the gate() tool. */
  mode: "auto" | "on-demand";
  /** Lifecycle point for an `auto` gate: `pre` (before work) or `post-verify` (after code verifies clean). */
  when: "pre" | "post-verify";
}

/**
 * Parse the `gates` allow-list from frontmatter. Accepts either a bare agent name
 * (string ⇒ an on-demand gate) or an object `{agent, mode?, when?}`. For backward
 * compatibility, the legacy `reviewGate` tick-box (default on) is translated into an
 * implicit auto reviewer gate that fires after verify.
 */
function parseGates(data: Record<string, unknown>): GateSpec[] {
  const raw = Array.isArray(data.gates) ? data.gates : [];
  const gates: GateSpec[] = [];
  for (const g of raw) {
    if (typeof g === "string") {
      gates.push({ agent: g, mode: "on-demand", when: "post-verify" });
    } else if (g && typeof g === "object" && "agent" in g) {
      const o = g as { agent: unknown; mode?: unknown; when?: unknown };
      gates.push({
        agent: String(o.agent),
        mode: o.mode === "on-demand" ? "on-demand" : "auto",
        when: o.when === "pre" ? "pre" : "post-verify",
      });
    }
  }
  // Legacy: `reviewGate` (default on) ⇒ an implicit auto reviewer gate after verify.
  if (data.reviewGate !== false && !gates.some((x) => x.agent === "reviewer")) {
    gates.push({ agent: "reviewer", mode: "auto", when: "post-verify" });
  }
  return gates;
}

/** A parsed `agent.md`: declarative frontmatter + markdown persona (system prompt). */
export interface AgentSpec {
  name: string;
  description: string;
  /** "<provider>:<model>" or the "${base}" sentinel. */
  model: string;
  fallbacks: string[];
  tools: string[];
  /** Allow-list of skill names this agent may load (empty = none injected). */
  skills: string[];
  /** Whether the orchestrator may delegate to this agent (default true). */
  delegable: boolean;
  /** MCP server names (from config.mcp.servers) whose tools this agent may use. */
  mcp: string[];
  /** Enable the automatic verify-repair loop on files this agent writes (default false). */
  verify: boolean;
  /** Inject `<name>.examples.md` worked examples into the prompt (tick-box, default on). */
  fewShot: boolean;
  /** Runtime self-healing: smoke-run written modules and repair crashes (needs verify; tick-box, default on). */
  selfHeal: boolean;
  /** Self-critique pass: after the turn, re-examine the output and produce a corrected final answer.
   * The reviewer's form of self-healing — validates each finding + re-scans for misses. Opt-in (default off). */
  selfCritique: boolean;
  /** Review gate: after this agent's written code verifies clean, run the `reviewer` agent on it and
   * feed any BLOCKER/MAJOR findings back for a fix round. Catches semantic bugs verify can't.
   * Tick-box, on by default; only actually fires for agents that write + verify code (e.g. the coder). */
  reviewGate: boolean;
  /** Gate allow-list: other agents this one may run as checking/planning steps (see GateSpec).
   * Includes any legacy `reviewGate` translated into an implicit auto reviewer gate. */
  gates: GateSpec[];
  /** Groundedness check (anti-hallucination): after this agent writes docs, verify that the concrete
   * claims (file paths, commands) actually exist in the workspace; loop back to fix invented ones.
   * The scribe's form of verification. Opt-in (default off; on for the scribe). */
  groundCheck: boolean;
  /** Self-learning from past runs — PARKED FOR PHASE 3; toggle recognized but inert for now. */
  selfLearn: boolean;
  /** Agent role, used by model profiles to route by tier (e.g. code, research, chat). */
  tier: string | undefined;
  system: string;
}

/** Parse a single-file `agent.md` into an AgentSpec. */
export function loadAgent(filePath: string): AgentSpec {
  const { data, content } = matter(readFileSync(filePath, "utf8"));
  if (!data.name) throw new Error(`Agent file "${filePath}" is missing "name" in frontmatter.`);
  if (!data.description) throw new Error(`Agent file "${filePath}" is missing "description" in frontmatter.`);

  return {
    name: String(data.name),
    description: String(data.description),
    model: data.model ? String(data.model) : "${base}",
    fallbacks: Array.isArray(data.fallbacks) ? data.fallbacks.map(String) : [],
    tools: Array.isArray(data.tools) ? data.tools.map(String) : [],
    skills: Array.isArray(data.skills) ? data.skills.map(String) : [],
    delegable: data.delegable !== false,
    mcp: Array.isArray(data.mcp) ? data.mcp.map(String) : [],
    verify: data.verify === true,
    fewShot: data.fewShot !== false,
    selfHeal: data.selfHeal !== false,
    selfCritique: data.selfCritique === true,
    reviewGate: data.reviewGate !== false,
    gates: parseGates(data),
    groundCheck: data.groundCheck === true,
    selfLearn: data.selfLearn !== false,
    tier: data.tier ? String(data.tier) : undefined,
    system: content.trim(),
  };
}

/** List all agents in a directory as {name, description} — used to tell the orchestrator who it can delegate to. */
export function listAgents(dir: string): Array<{ name: string; description: string; delegable: boolean }> {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const out: Array<{ name: string; description: string; delegable: boolean }> = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    try {
      const spec = loadAgent(join(dir, f));
      out.push({ name: spec.name, description: spec.description, delegable: spec.delegable });
    } catch {
      /* skip malformed agent files */
    }
  }
  return out;
}

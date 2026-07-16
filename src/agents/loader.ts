import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

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
   * feed any BLOCKER/MAJOR findings back for a fix round. Catches semantic bugs verify can't. Opt-in. */
  reviewGate: boolean;
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
    reviewGate: data.reviewGate === true,
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

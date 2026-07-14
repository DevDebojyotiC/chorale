import { tool } from "ai";
import { z } from "zod";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadAgent } from "../agents/loader.js";
import type { AgentSpec } from "../agents/loader.js";
import type { ChoraleConfig } from "../core/config.js";
import type { Registry } from "../core/model-registry.js";
import type { RunResult } from "../core/runtime.js";
import type { PermissionMode } from "./permissions.js";

/** The runtime's runAgent, injected to avoid an import cycle. */
export type Runner = (opts: {
  config: ChoraleConfig;
  registry: Registry;
  agent: AgentSpec;
  prompt: string;
  depth: number;
  stream: boolean;
  permissionMode: PermissionMode;
}) => Promise<RunResult>;

export interface DelegateContext {
  config: ChoraleConfig;
  registry: Registry;
  depth: number;
  maxDepth: number;
  permissionMode: PermissionMode;
  run: Runner;
}

/**
 * Build a `delegate` tool that spawns a named specialist agent on a self-contained
 * sub-task, runs it (non-streaming), and returns its result. Depth-guarded to
 * prevent runaway delegation.
 */
export function createDelegateTool(ctx: DelegateContext) {
  const { config, registry, depth, maxDepth, permissionMode, run } = ctx;
  return tool({
    description:
      "Delegate a self-contained sub-task to a specialist agent (e.g. research). The specialist cannot see this conversation, so give it a clear, standalone task. Returns the specialist's result.",
    inputSchema: z.object({
      agent: z.string().describe("The specialist agent name to delegate to"),
      task: z.string().describe("A clear, self-contained task or question for the specialist"),
    }),
    execute: async ({ agent: agentName, task }) => {
      if (depth >= maxDepth) {
        return { error: `Delegation depth limit (${maxDepth}) reached — answer this yourself.` };
      }
      const file = resolve(config.agents.dir, `${agentName}.md`);
      if (!existsSync(file)) return { error: `Unknown agent "${agentName}".` };

      let spec: AgentSpec;
      try {
        spec = loadAgent(file);
      } catch (e) {
        return { error: `Failed to load agent "${agentName}": ${e instanceof Error ? e.message : String(e)}` };
      }

      process.stderr.write(`\n[delegate → ${agentName}] ${task.slice(0, 90)}\n`);
      try {
        const res = await run({ config, registry, agent: spec, prompt: task, depth: depth + 1, stream: false, permissionMode });
        return { agent: agentName, model: res.model, result: res.text };
      } catch (e) {
        return { error: `Delegation to "${agentName}" failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });
}

import { streamText, stepCountIs } from "ai";
import type { LanguageModelUsage, ToolSet } from "ai";
import type { ChoraleConfig } from "./config.js";
import type { Registry, ModelRef } from "./model-registry.js";
import { resolveRef } from "./model-registry.js";
import type { AgentSpec } from "../agents/loader.js";
import type { ChatMessage } from "./session.js";
import { listAgents } from "../agents/loader.js";
import { selectTools } from "../tools/registry.js";
import { createSkillViewTool } from "../tools/skill.js";
import { createDelegateTool } from "../tools/delegate.js";
import { discoverSkills, selectSkills, renderSkillsForPrompt } from "../skills/loader.js";
import { connectMcpServers } from "../mcp/client.js";
import { createTagStripper, TOOL_MARKUP_TOKENS } from "./stream-filter.js";

export interface RunResult {
  /** The model ref that actually produced the answer. */
  model: string;
  text: string;
  usage: LanguageModelUsage | undefined;
}

export interface RunOptions {
  config: ChoraleConfig;
  registry: Registry;
  agent: AgentSpec;
  prompt: string;
  /** Prior conversation turns to continue from (for resumed sessions). */
  history?: ChatMessage[];
  /** Current delegation depth (0 at the top level; incremented per delegate hop). */
  depth?: number;
  /** Force a specific "<provider>:<model>", overriding the agent's model. */
  modelOverride?: string;
  /** Stream tokens to stdout as they arrive (default true). */
  stream?: boolean;
}

/**
 * Run one turn of an agent, walking a fallback chain until a model succeeds:
 *   modelOverride → agent.model → agent.fallbacks → base.fallbacks → base.model
 * This is the minimal self-healing behavior; richer failover (cooldowns,
 * credential rotation) lands in a later phase.
 */
export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const { config, registry, agent, prompt, modelOverride } = opts;
  const stream = opts.stream ?? true;

  const rawChain = [
    modelOverride,
    agent.model,
    ...agent.fallbacks,
    ...config.base.fallbacks,
    config.base.model,
  ].filter((ref): ref is string => Boolean(ref));

  const chain = [...new Set(rawChain.map((ref) => resolveRef(ref, config)))];

  // Assemble tools: the agent's built-in tool allow-list, plus skill_view when
  // the agent has skills. Skills use progressive disclosure — only their
  // names+descriptions go in the prompt; bodies load on demand via skill_view.
  const agentSkills = selectSkills(discoverSkills(config.skills.dirs), agent.skills);
  const mcp = await connectMcpServers(config, agent.mcp);
  const builtinToolNames = agent.tools.filter((t) => t !== "delegate");
  const tools: ToolSet = { ...selectTools(builtinToolNames), ...mcp.tools };
  if (agentSkills.length > 0) tools.skill_view = createSkillViewTool(agentSkills);

  // Delegation: when an agent lists the `delegate` tool, give it the tool plus a
  // roster of the specialists it can hand sub-tasks to.
  let delegateBlock = "";
  if (agent.tools.includes("delegate")) {
    tools.delegate = createDelegateTool({
      config,
      registry,
      depth: opts.depth ?? 0,
      maxDepth: config.defaults.maxDelegationDepth,
      run: runAgent,
    });
    const specialists = listAgents(config.agents.dir).filter((a) => a.delegable && a.name !== agent.name);
    if (specialists.length > 0) {
      delegateBlock =
        "## Specialists you can delegate to (via the delegate tool)\n" +
        specialists.map((a) => `- ${a.name}: ${a.description}`).join("\n") +
        "\n\n";
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const system = `Current date: ${today}.\n\n${delegateBlock}${renderSkillsForPrompt(agentSkills)}${agent.system}`;
  const messages: ChatMessage[] = [...(opts.history ?? []), { role: "user", content: prompt }];

  try {
    let lastError: unknown;
    for (const ref of chain) {
      try {
        const model = registry.languageModel(ref as ModelRef);
        // Capture stream errors ourselves; the SDK's default onError logs a full
        // stack trace to the console, which we don't want when we can fall back.
        let streamError: unknown;
        const result = streamText({
          model,
          system,
          messages,
          tools,
          stopWhen: stepCountIs(config.defaults.maxSteps),
          onStepFinish: ({ toolCalls }) => {
            for (const call of toolCalls) {
              const input = JSON.stringify(call.input);
              const preview = input.length > 140 ? `${input.slice(0, 140)}…` : input;
              process.stderr.write(`\n[tool] ${call.toolName} ${preview}\n`);
            }
          },
          onError: ({ error }) => {
            streamError = error;
          },
        });

        const stripper = createTagStripper(TOOL_MARKUP_TOKENS);
        let text = "";
        for await (const delta of result.textStream) {
          const clean = stripper.push(delta);
          text += clean;
          if (stream && clean) process.stdout.write(clean);
        }
        const tail = stripper.flush();
        text += tail;
        if (stream && tail) process.stdout.write(tail);
        if (streamError) throw streamError;
        if (stream && text) process.stdout.write("\n");

        const usage = await Promise.resolve(result.totalUsage).catch(() => undefined);
        return { model: ref, text, usage };
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`\n[chorale] model "${ref}" failed: ${msg}\n`);
        if (ref !== chain[chain.length - 1]) {
          process.stderr.write(`[chorale] falling back to next model…\n`);
        }
      }
    }

    const last = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`All models in the fallback chain failed (${chain.join(", ")}). Last error: ${last}`);
  } finally {
    await mcp.close();
  }
}

import { streamText, stepCountIs, NoSuchToolError } from "ai";
import type { LanguageModelUsage, ToolSet } from "ai";
import type { ChoraleConfig } from "./config.js";
import type { Registry, ModelRef } from "./model-registry.js";
import { resolveRef } from "./model-registry.js";
import type { AgentSpec } from "../agents/loader.js";
import type { ChatMessage } from "./session.js";
import { listAgents } from "../agents/loader.js";
import { buildToolSet } from "../tools/registry.js";
import type { PermissionMode } from "../tools/permissions.js";
import { createSkillViewTool } from "../tools/skill.js";
import { createDelegateTool } from "../tools/delegate.js";
import { discoverSkills, selectSkills, renderSkillsForPrompt } from "../skills/loader.js";
import { connectMcpServers } from "../mcp/client.js";
import { createTagStripper, TOOL_MARKUP_TOKENS } from "./stream-filter.js";
import { verifyFiles, verifyFeedback } from "./verify.js";
import { parseTextToolCalls, extractCodeBlocks, inferFilename, type ParsedToolCall } from "./tool-call-salvage.js";

/** File-mutating tools — used to detect no-op turns from weak models. */
const WRITE_TOOL_NAMES = new Set(["write", "edit", "multi_edit"]);

/**
 * Execute tool calls that a model wrote as plain text (JSON, tags, or a lone code
 * block). Returns short summaries for feedback. Missing write paths are inferred
 * from the prompt (small models often drop the path).
 */
async function salvageTextTools(text: string, tools: ToolSet, known: Set<string>, prompt: string): Promise<string[]> {
  const calls: ParsedToolCall[] = parseTextToolCalls(text, known);
  if (calls.length === 0 && "write" in tools) {
    const blocks = extractCodeBlocks(text);
    const fn = inferFilename(prompt);
    if (blocks.length === 1 && fn && (blocks[0]?.code.length ?? 0) > 0) {
      calls.push({ name: "write", args: { path: fn, content: blocks[0]!.code } });
    }
  }

  const summaries: string[] = [];
  for (const call of calls) {
    const tool = tools[call.name] as { execute?: (a: unknown, o: unknown) => Promise<unknown> } | undefined;
    if (!tool?.execute) continue;
    let args = call.args;
    if (WRITE_TOOL_NAMES.has(call.name) && typeof args.path !== "string") {
      const fn = inferFilename(prompt);
      if (fn) args = { ...args, path: fn };
    }
    try {
      const out = await tool.execute(args, {});
      const p = typeof args.path === "string" ? args.path : "";
      process.stderr.write(`\n[tool·salvaged] ${call.name} ${p}\n`);
      summaries.push(`${call.name}(${p}) → ${JSON.stringify(out).slice(0, 120)}`);
    } catch (e) {
      summaries.push(`${call.name} → error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return summaries;
}

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
  /** Permission mode override (from CLI flags); falls back to config.permissions.mode. */
  permissionMode?: PermissionMode;
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
  const permissionMode: PermissionMode = opts.permissionMode ?? config.permissions.mode;
  const cwd = process.cwd();
  // Files the agent writes this run — fed to the verify-repair loop.
  const touched = new Set<string>();
  const tools: ToolSet = {
    ...buildToolSet(agent.tools, { mode: permissionMode, cwd, touched }),
    ...mcp.tools,
  };
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
      permissionMode,
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

  // Whether the latest attempt tried to write files — used to detect no-op turns
  // where a weak model emits write calls with empty/invalid arguments.
  let sawWriteAttempt = false;
  // Whether the latest attempt made ANY native tool call — if not, we try to
  // salvage tool calls the model wrote as plain text.
  let sawNativeToolCall = false;

  // One pass through the model fallback chain, streaming a single answer.
  const attempt = async (): Promise<RunResult> => {
    sawWriteAttempt = false;
    sawNativeToolCall = false;
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
          // Recover a doubly-JSON-encoded argument string before it's rejected.
          // (Empty/irrecoverable args are handled by the no-op retry below.)
          repairToolCall: async ({ toolCall, error }) => {
            if (NoSuchToolError.isInstance(error)) return null;
            const raw = (toolCall as { input?: unknown }).input;
            if (typeof raw === "string") {
              try {
                const once: unknown = JSON.parse(raw);
                if (typeof once === "string") return { ...toolCall, input: once };
              } catch {
                /* not recoverable here */
              }
            }
            return null;
          },
          onStepFinish: ({ toolCalls }) => {
            if (toolCalls.length > 0) sawNativeToolCall = true;
            for (const call of toolCalls) {
              if (WRITE_TOOL_NAMES.has(call.toolName)) sawWriteAttempt = true;
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
  };

  try {
    let result = await attempt();

    // Completion loop: (1) salvage tool calls a non-native model wrote as text and
    // execute them; (2) for coder-style agents, verify written files and repair,
    // retrying no-ops. This is what makes even local, non-tool-calling models work.
    const toolNames = new Set(Object.keys(tools));
    const maxRounds = config.defaults.maxVerifyRounds;
    for (let round = 0; round < maxRounds; round++) {
      const isLast = round === maxRounds - 1;

      // (1) Salvage: the model wrote tool calls as text instead of calling natively.
      if (!sawNativeToolCall && toolNames.size > 0) {
        const salvaged = await salvageTextTools(result.text, tools, toolNames, prompt);
        if (salvaged.length > 0) {
          process.stderr.write(`\n[chorale] salvaged ${salvaged.length} tool call(s) written as text\n`);
          if (isLast) break;
          messages.push({ role: "assistant", content: result.text });
          messages.push({
            role: "user",
            content:
              "I executed the tool call(s) you wrote as text:\n" +
              salvaged.map((s) => `- ${s}`).join("\n") +
              "\nIf the task is complete, briefly confirm; otherwise continue.",
          });
          result = await attempt();
          continue;
        }
      }

      // (2) Verify-repair — only for agents that opt in (e.g. coder).
      if (!agent.verify) break;

      // No-op turn: writes attempted but nothing landed (empty/invalid args).
      if (sawWriteAttempt && touched.size === 0) {
        if (isLast) {
          process.stderr.write(`\n[chorale] ⚠ writes were attempted but none succeeded after ${maxRounds} tries\n`);
          break;
        }
        process.stderr.write(`\n[chorale] ⚠ no files were written (tool arguments were empty/invalid) — retrying…\n`);
        messages.push({ role: "assistant", content: result.text || "(no files written)" });
        messages.push({
          role: "user",
          content:
            "Your previous write/edit tool call(s) did not take effect — the arguments were missing. " +
            "Call the write tool AGAIN now with explicit `path` and `content` arguments to actually create the file. " +
            "Do not describe the file; write it.",
        });
        result = await attempt();
        continue;
      }

      if (touched.size === 0) break; // nothing was written (e.g. a plain question)

      const issues = await verifyFiles([...touched], cwd);
      if (issues.length === 0) {
        process.stderr.write(
          round > 0
            ? `\n[chorale] ✓ verification passed after ${round} fix round(s)\n`
            : `\n[chorale] ✓ code verified clean\n`,
        );
        break;
      }
      if (isLast) {
        process.stderr.write(`\n[chorale] ⚠ ${issues.length} issue(s) remain after ${maxRounds} verify rounds\n`);
        break;
      }
      process.stderr.write(`\n[chorale] ⚠ verification found ${issues.length} issue(s) — asking the model to fix…\n`);
      for (const i of issues.slice(0, 6)) process.stderr.write(`    ${i.file}: ${i.message}\n`);
      messages.push({ role: "assistant", content: result.text || "(wrote files)" });
      messages.push({ role: "user", content: verifyFeedback(issues) });
      result = await attempt();
    }

    return result;
  } finally {
    await mcp.close();
  }
}

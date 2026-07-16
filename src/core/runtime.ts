import { streamText, stepCountIs, NoSuchToolError } from "ai";
import type { LanguageModelUsage, ToolSet } from "ai";
import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import type { ChoraleConfig } from "./config.js";
import type { Registry, ModelRef } from "./model-registry.js";
import { resolveModelPlan } from "./model-policy.js";
import type { AgentSpec } from "../agents/loader.js";
import type { ChatMessage } from "./session.js";
import { listAgents, loadAgent } from "../agents/loader.js";
import { buildToolSet } from "../tools/registry.js";
import type { PermissionMode } from "../tools/permissions.js";
import { createSkillViewTool } from "../tools/skill.js";
import { createDelegateTool } from "../tools/delegate.js";
import { discoverSkills, selectSkills, renderSkillsForPrompt } from "../skills/loader.js";
import { connectMcpServers } from "../mcp/client.js";
import { createTagStripper, TOOL_MARKUP_TOKENS } from "./stream-filter.js";
import { verifyFiles, verifyFeedback } from "./verify.js";
import { smokeTest, smokeFeedback } from "./smoke.js";
import { checkGroundedness, groundednessFeedback } from "./ground.js";
import { matchDiagnoses } from "./diagnose.js";
import { getLessonStore } from "./lessons.js";
import { log } from "./log.js";
import { parseTextToolCalls, extractCodeBlocks, inferFilename, ensureExports, type ParsedToolCall } from "./tool-call-salvage.js";

/** File-mutating tools — used to detect no-op turns from weak models. */
const WRITE_TOOL_NAMES = new Set(["write", "edit", "multi_edit"]);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Exponential backoff with jitter, capped at 8s. */
export const backoffMs = (n: number): number => Math.min(8000, 500 * 2 ** n) + Math.floor(Math.random() * 250);

/**
 * A fast, transient failure worth retrying on the SAME model: rate limits (429),
 * server errors (5xx), and connection resets. Timeouts/aborts are deliberately
 * NOT retriable — a hung provider stays hung, so we fall back instead of waiting again.
 */
export function isRetriable(e: unknown): boolean {
  const anyE = e as { statusCode?: number; status?: number; message?: string; name?: string };
  const status = anyE?.statusCode ?? anyE?.status;
  if (status === 429 || (typeof status === "number" && status >= 500 && status < 600)) return true;
  const msg = `${anyE?.name ?? ""} ${anyE?.message ?? String(e)}`;
  if (/timed?\s*out|timeout|aborted|AbortError|TimeoutError/i.test(msg)) return false;
  return /\b429\b|\b5\d\d\b|rate.?limit|overloaded|too many requests|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|fetch failed|socket hang up|network error/i.test(msg);
}

/**
 * Self-critique instruction (used by agents with `selfCritique: true`, e.g. the reviewer).
 * Drives a second pass that improves BOTH precision (drop unsupported severe findings) and
 * recall (re-scan for misses) before the answer is shown.
 */
// Agent-agnostic: re-read the answer against the agent's OWN rules (already in its system
// prompt) and against the actual files. Works for any selfCritique agent — for the reviewer
// "claims/findings" are review findings; for the scribe they are doc claims.
const SELF_CRITIQUE_PROMPT =
  "Before finalizing, critically re-examine your answer against the actual code/files and your own rules. Change it ONLY where you are clearly right — a good draft should mostly survive.\n" +
  "1. KEEP every claim or finding you can back with a concrete fact in the files — do not drop or weaken something you verified. (In a code review, keep every real bug — especially security issues.)\n" +
  "2. REMOVE or CORRECT anything you cannot verify against the files: invented names, paths, numbers, commands, or an unsupported claim/finding. Never assert what you did not check.\n" +
  "3. Make sure you fully addressed the request; add a missing point only if you are confident it is correct.\n" +
  "Then output your FINAL, corrected answer in the exact format your instructions require. Output only the final answer — no commentary about this revision.";

/**
 * Security classes a self-critiquing agent can learn to scan for: if the critique
 * pass surfaces one the first draft missed, that's a sound "I overlooked this" signal
 * (the reviewer's analog of the coder's diagnosed-repair → lesson). Recorded as a
 * proactive lesson so future reviews check it up front.
 */
const REVIEW_LESSON_CLASSES: { key: string; label: string; terms: string[] }[] = [
  { key: "sec-injection", label: "injection (SQL/command/path from unsanitized input)", terms: ["sql injection", "command injection", "path traversal"] },
  { key: "sec-proto", label: "prototype pollution (__proto__/constructor keys from untrusted input)", terms: ["prototype pollution", "__proto__"] },
  { key: "sec-redos", label: "ReDoS (ambiguous/overlapping regex quantifiers on untrusted input)", terms: ["redos", "catastrophic backtrack"] },
  { key: "sec-ssrf", label: "SSRF (server-side fetch of a user-supplied URL)", terms: ["ssrf", "server-side request forgery"] },
  { key: "sec-verify", label: "broken verification (trusting an unsigned/unverified token or payload)", terms: ["signature", "unverified", "not verified", "without verifying"] },
  { key: "sec-timing", label: "timing attack (non-constant-time secret/MAC comparison)", terms: ["timing attack", "constant-time", "timingsafeequal"] },
  { key: "sec-deser", label: "unsafe deserialization / dynamic eval of untrusted data", terms: ["unsafe deserialization", "eval(", "insecure deserialization"] },
];

/** Labels of security classes named in a review (case-insensitive term match). */
export function securityClassesIn(text: string): Set<string> {
  const lower = text.toLowerCase();
  const out = new Set<string>();
  for (const c of REVIEW_LESSON_CLASSES) if (c.terms.some((t) => lower.includes(t))) out.add(c.key);
  return out;
}

/**
 * Review gate: after a coding agent's output verifies clean, ask the `reviewer` agent
 * for a semantic second opinion on the written files and return its BLOCKER/MAJOR
 * finding lines (empty = approved). Single-pass (no self-critique) to bound cost.
 */
async function reviewGateFindings(
  files: string[],
  cwd: string,
  config: ChoraleConfig,
  registry: Registry,
): Promise<string[]> {
  const reviewerFile = resolve(config.agents.dir, "reviewer.md");
  if (!existsSync(reviewerFile)) return [];
  const reviewer = loadAgent(reviewerFile);
  const parts: string[] = [];
  for (const f of files) {
    const p = isAbsolute(f) ? f : resolve(cwd, f);
    try {
      parts.push(`### ${f}\n\`\`\`\n${readFileSync(p, "utf8")}\n\`\`\``);
    } catch {
      /* file gone/unreadable — skip */
    }
  }
  if (parts.length === 0) return [];
  const prompt =
    "Review these just-written files for correctness and security BUGS only (ignore style/nits). " +
    "Report findings in your exact format and end with a VERDICT.\n\n" +
    parts.join("\n\n");
  const prev = process.env.CHORALE_NO_CRITIQUE;
  process.env.CHORALE_NO_CRITIQUE = "1"; // one reviewer pass for the gate
  try {
    const res = await runAgent({ config, registry, agent: reviewer, prompt, permissionMode: "read-only", stream: false });
    log.debug(`[chorale] review gate raw: ${res.text.length} chars · ${res.text.match(/VERDICT:[^\n]*/)?.[0] ?? "(no verdict)"}\n`);
    return res.text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^-?\s*\[\s*(BLOCKER|MAJOR)\s*\]/i.test(l));
  } catch (err) {
    log.info(`[chorale] review gate errored: ${err instanceof Error ? err.message : String(err)}\n`);
    return []; // a failed gate must not block the coder's result
  } finally {
    if (prev === undefined) delete process.env.CHORALE_NO_CRITIQUE;
    else process.env.CHORALE_NO_CRITIQUE = prev;
  }
}

/** ~char budget guarding the model's context window (~30k tokens). */
const MAX_CONTEXT_CHARS = 120_000;
/**
 * Keep the conversation under a char budget so a long verify-repair chain or a big
 * resumed session can't overflow the context window (or balloon cost). Preserves the
 * earliest message (the task) and the most recent turns; drops the stale middle.
 */
export function capContext(msgs: ChatMessage[], keepRecent = 8): void {
  const total = (): number => msgs.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0);
  while (total() > MAX_CONTEXT_CHARS && msgs.length > keepRecent + 1) {
    msgs.splice(1, 1); // drop the oldest-after-first; index 0 (task) and the tail stay
  }
}

/**
 * Execute tool calls that a model wrote as plain text (JSON, tags, or a lone code
 * block). Returns short summaries for feedback. Missing write paths are inferred
 * from the prompt (small models often drop the path).
 */
async function salvageTextTools(text: string, tools: ToolSet, known: Set<string>, prompt: string): Promise<string[]> {
  const calls: ParsedToolCall[] = parseTextToolCalls(text, known);
  if (calls.length === 0 && "write" in tools) {
    // Don't treat a block that is itself a tool-call object (e.g. a ```json fence
    // wrapping {"name":"write",...}) as file contents — that's a call we failed to parse.
    const isToolCallJson = (code: string) => /^\s*\{[\s\S]*"(?:name|tool|tool_name)"\s*:/.test(code);
    const isFilename = (s: string) => /^[\w.\-/]+\.[A-Za-z0-9]{1,6}$/.test(s);
    const blocks = extractCodeBlocks(text).filter((b) => b.code.length > 0 && !isToolCallJson(b.code));
    // Preferred format: one fence per file, tagged with the file path (```solution.mjs).
    const named = blocks.filter((b) => isFilename(b.lang));
    if (named.length > 0) {
      for (const b of named) calls.push({ name: "write", args: { path: b.lang, content: b.code } });
    } else {
      // Otherwise a single untagged code block → the file named in the prompt.
      const fn = inferFilename(prompt);
      if (blocks.length === 1 && fn) calls.push({ name: "write", args: { path: fn, content: blocks[0]!.code } });
    }
  }

  const summaries: string[] = [];
  for (const call of calls) {
    const tool = tools[call.name] as { execute?: (a: unknown, o: unknown) => Promise<unknown> } | undefined;
    if (!tool?.execute) continue;
    let args = call.args;
    if (WRITE_TOOL_NAMES.has(call.name)) {
      if (typeof args.path !== "string") {
        const fn = inferFilename(prompt);
        if (fn) args = { ...args, path: fn };
      } else {
        // Strip a leading slash so an "absolute" path stays inside the workspace.
        args = { ...args, path: args.path.replace(/^[/\\]+/, "") };
      }
      // Whole-file writes: rescue a module the model forgot to export from.
      if (call.name === "write" && typeof args.content === "string" && typeof args.path === "string") {
        args = { ...args, content: ensureExports(args.content, args.path) };
      }
    }
    try {
      const out = await tool.execute(args, {});
      const p = typeof args.path === "string" ? args.path : "";
      log.debug(`\n[tool·salvaged] ${call.name} ${p}\n`);
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
  /** Active model profile name (overrides config.activeProfile for this run). */
  profile?: string;
  /** Stream tokens to stdout as they arrive (default true). */
  stream?: boolean;
  /** If set, stream text is routed here instead of stdout (for a TUI/renderer). */
  onToken?: (text: string) => void;
  /** If set, receives structured activity events (tool calls, verify/heal, fallback). */
  onEvent?: (e: RunEvent) => void;
  /** Max model steps per attempt (overrides config.defaults.maxSteps for multi-file work). */
  maxSteps?: number;
  /** Agent names already on the delegation path (for cycle detection). */
  delegationPath?: string[];
}

/** A structured activity event for a renderer (the TUI subscribes to these). */
export interface RunEvent {
  type: "tool" | "salvage" | "verify" | "heal" | "fallback" | "lesson";
  text: string;
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

  const plan = resolveModelPlan(agent, config, modelOverride, opts.profile);
  const chain = [plan.model, ...plan.fallbacks];

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
      path: [...(opts.delegationPath ?? []), agent.name],
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

  // Few-shot: inject the agent's worked examples (<name>.examples.md) when enabled.
  // Showing correct patterns tends to beat stating rules for weaker models.
  let fewShotBlock = "";
  if (agent.fewShot) {
    try {
      const exFile = resolve(config.agents.dir, `${agent.name}.examples.md`);
      if (existsSync(exFile)) fewShotBlock = `\n\n${readFileSync(exFile, "utf8").trim()}`;
    } catch {
      /* no examples file — skip */
    }
  }

  // Self-learning: inject the agent's proven lessons (from past repairs) so it
  // avoids known mistakes proactively. Disabled with CHORALE_NO_LEARN=1 (eval).
  const learn = agent.selfLearn && process.env.CHORALE_NO_LEARN !== "1";
  let lessonsBlock = "";
  if (learn) {
    try {
      const lessons = getLessonStore().top(agent.name, 6);
      if (lessons.length > 0) {
        lessonsBlock = "\n\n## Lessons learned from past runs (apply these proactively)\n" + lessons.map((l) => `- ${l.lesson}`).join("\n");
        log.debug(`\n[chorale] applying ${lessons.length} learned lesson(s)\n`);
      }
    } catch {
      /* lesson store unavailable — skip */
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const system = `Current date: ${today}.\n\n${delegateBlock}${renderSkillsForPrompt(agentSkills)}${agent.system}${fewShotBlock}${lessonsBlock}`;
  const messages: ChatMessage[] = [...(opts.history ?? []), { role: "user", content: prompt }];

  // Self-critique (the reviewer's form of self-healing): after the main turn, feed
  // the draft answer back and ask the model to validate + correct it. The draft is
  // computed silently (suppressOutput) so only the final, corrected answer is shown.
  const critique = agent.selfCritique && process.env.CHORALE_NO_CRITIQUE !== "1";
  let suppressOutput = critique;

  // Review gate: after this agent's code verifies clean, get a semantic second opinion
  // from the reviewer and fix any BLOCKER/MAJOR it finds. Disable with CHORALE_NO_REVIEW_GATE=1.
  const reviewGate = agent.reviewGate && process.env.CHORALE_NO_REVIEW_GATE !== "1";

  // Whether the latest attempt tried to write files — used to detect no-op turns
  // where a weak model emits write calls with empty/invalid arguments.
  let sawWriteAttempt = false;
  // Whether the latest attempt made ANY native tool call — if not, we try to
  // salvage tool calls the model wrote as plain text.
  let sawNativeToolCall = false;
  // Token usage accumulated across EVERY attempt (fallbacks + salvage/verify
  // rounds), so callers see the true cost of the turn, not just the last call.
  let cumInput = 0;
  let cumOutput = 0;
  let cumTotal = 0;
  let sawUsage = false;

  // One pass through the model fallback chain, streaming a single answer.
  // `temperature` is raised on repair rounds so the model doesn't regenerate the
  // exact same (broken) tokens it just produced — the key to actually fixing code.
  const attempt = async (temperature?: number): Promise<RunResult> => {
    sawWriteAttempt = false;
    sawNativeToolCall = false;
    capContext(messages);
    let lastError: unknown;
    const timeoutMs = config.defaults.requestTimeoutMs;
    const maxRetries = config.defaults.maxRetries;
    for (const ref of chain) {
      // Retry the SAME model on fast transient errors before falling back.
      for (let tryN = 0; ; tryN++) {
      // True once we've streamed any output — then we must NOT retry (would double-print).
      let emittedAny = false;
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
          ...(temperature !== undefined ? { temperature } : {}),
          abortSignal: AbortSignal.timeout(timeoutMs),
          stopWhen: stepCountIs(opts.maxSteps ?? config.defaults.maxSteps),
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
              log.debug(`\n[tool] ${call.toolName} ${preview}\n`);
              const p = (call.input as { path?: string })?.path;
              opts.onEvent?.({ type: "tool", text: typeof p === "string" ? `${call.toolName} ${p}` : call.toolName });
            }
          },
          onError: ({ error }) => {
            streamError = error;
          },
        });

        const emitText = (s: string): void => {
          if (!s) return;
          if (suppressOutput) return; // consumed (accumulated into `text`) but not shown — e.g. the draft before a self-critique pass
          if (opts.onToken) opts.onToken(s);
          else if (stream) process.stdout.write(s);
          emittedAny = true;
        };
        const stripper = createTagStripper(TOOL_MARKUP_TOKENS);
        let text = "";
        for await (const delta of result.textStream) {
          const clean = stripper.push(delta);
          text += clean;
          emitText(clean);
        }
        const tail = stripper.flush();
        text += tail;
        emitText(tail);
        if (streamError) throw streamError;
        if (stream && !opts.onToken && text && !suppressOutput) process.stdout.write("\n");

        const usage = await Promise.resolve(result.totalUsage).catch(() => undefined);
        if (usage) {
          if (usage.inputTokens != null || usage.outputTokens != null || usage.totalTokens != null) sawUsage = true;
          cumInput += usage.inputTokens ?? 0;
          cumOutput += usage.outputTokens ?? 0;
          cumTotal += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
        }
        return { model: ref, text, usage };
      } catch (err) {
        // Same-model retry on a fast transient error — but only if nothing was streamed yet.
        if (isRetriable(err) && tryN < maxRetries && !emittedAny) {
          const waitMs = backoffMs(tryN);
          log.info(`\n[chorale] transient error from "${ref}" — retry ${tryN + 1}/${maxRetries} in ${waitMs}ms…\n`);
          await sleep(waitMs);
          continue;
        }
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        log.info(`\n[chorale] model "${ref}" failed: ${msg}\n`);
        if (ref !== chain[chain.length - 1]) {
          log.info(`[chorale] falling back to next model…\n`);
          opts.onEvent?.({ type: "fallback", text: `${ref} failed — falling back` });
        }
        break; // give up on this model, advance to the next in the chain
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
    // Escalate sampling each repair round: forces a different completion so the
    // model can escape a wrong answer it would otherwise reproduce verbatim.
    const repairTemp = (round: number) => Math.min(0.9, 0.5 + 0.2 * round);
    // Self-learning: the diagnoses shown last round, pending a win/loss verdict this round.
    let pending: { key: string; lesson: string }[] = [];
    const learnStore = learn ? getLessonStore() : null;
    for (let round = 0; round < maxRounds; round++) {
      const isLast = round === maxRounds - 1;

      // (1) Salvage: the model wrote tool calls as text instead of calling natively.
      if (!sawNativeToolCall && toolNames.size > 0) {
        const salvaged = await salvageTextTools(result.text, tools, toolNames, prompt);
        if (salvaged.length > 0) {
          log.info(`\n[chorale] salvaged ${salvaged.length} tool call(s) written as text\n`);
          if (isLast) break;
          messages.push({ role: "assistant", content: result.text });
          messages.push({
            role: "user",
            content:
              "I executed the tool call(s) you wrote as text:\n" +
              salvaged.map((s) => `- ${s}`).join("\n") +
              "\nIf the task is complete, briefly confirm; otherwise continue.",
          });
          result = await attempt(repairTemp(round));
          continue;
        }
      }

      // (1.5) Groundedness check — for doc agents (e.g. scribe). The anti-hallucination
      // pass: verify the paths the written docs reference actually exist; fix invented ones.
      if (agent.groundCheck && process.env.CHORALE_NO_GROUND !== "1") {
        if (touched.size === 0) break; // a plain answer, nothing written
        const missing = checkGroundedness([...touched], cwd);
        if (missing.length === 0) {
          log.info(round > 0 ? `\n[chorale] ✓ docs grounded after ${round} fix round(s)\n` : `\n[chorale] ✓ docs grounded (all referenced paths exist)\n`);
          break;
        }
        if (isLast) {
          log.info(`\n[chorale] ⚠ ${missing.length} unresolved path reference(s) remain after ${maxRounds} rounds\n`);
          break;
        }
        log.info(`\n[chorale] ⚠ groundedness: ${missing.length} invented path reference(s) — asking to fix…\n`);
        for (const m of missing.slice(0, 6)) log.info(`    ${m.file}: ${m.ref}\n`);
        opts.onEvent?.({ type: "verify", text: `groundedness: ${missing.length} invented ref(s) — fixing` });
        messages.push({ role: "assistant", content: result.text || "(wrote docs)" });
        messages.push({ role: "user", content: groundednessFeedback(missing) });
        result = await attempt(repairTemp(round));
        continue;
      }

      // (2) Verify-repair — only for agents that opt in (e.g. coder).
      if (!agent.verify) break;

      // No-op turn: writes attempted but nothing landed (empty/invalid args).
      if (sawWriteAttempt && touched.size === 0) {
        if (isLast) {
          log.info(`\n[chorale] ⚠ writes were attempted but none succeeded after ${maxRounds} tries\n`);
          break;
        }
        log.info(`\n[chorale] ⚠ no files were written (tool arguments were empty/invalid) — retrying…\n`);
        messages.push({ role: "assistant", content: result.text || "(no files written)" });
        messages.push({
          role: "user",
          content:
            "Your previous write/edit tool call(s) did not take effect — the arguments were missing. " +
            "Call the write tool AGAIN now with explicit `path` and `content` arguments to actually create the file. " +
            "Do not describe the file; write it.",
        });
        result = await attempt(repairTemp(round));
        continue;
      }

      if (touched.size === 0) break; // nothing was written (e.g. a plain question)

      // (a) Syntax verification (fast). (b) Self-healing runtime smoke test — only
      // when syntax is clean, since there's no point running code that won't parse.
      const syntax = await verifyFiles([...touched], cwd);
      let issues: { file: string; message: string }[] = syntax;
      let feedback = syntax.length ? verifyFeedback(syntax) : "";
      let kind = "verification";
      if (syntax.length === 0 && agent.selfHeal) {
        const smoke = await smokeTest([...touched], cwd);
        if (smoke.length > 0) { issues = smoke; feedback = smokeFeedback(smoke); kind = "runtime (self-heal)"; }
      }
      if (issues.length === 0) {
        // Review gate: a semantic second opinion from the reviewer on the clean code.
        // Catches logic/security bugs that syntax + smoke can't. Bounded by the repair budget.
        if (reviewGate && !isLast) {
          const findings = await reviewGateFindings([...touched], cwd, config, registry);
          if (findings.length > 0) {
            log.info(`\n[chorale] ⚠ review gate: ${findings.length} blocking finding(s) — asking the coder to fix…\n`);
            for (const f of findings.slice(0, 6)) log.info(`    ${f}\n`);
            opts.onEvent?.({ type: "verify", text: `review gate: ${findings.length} finding(s) — fixing` });
            messages.push({ role: "assistant", content: result.text || "(wrote files)" });
            messages.push({
              role: "user",
              content:
                "A code reviewer flagged these blocking issue(s) in the files you just wrote:\n" +
                findings.join("\n") +
                "\nFix each one by rewriting the affected file(s) with correct code. Address the root cause, not the symptom.",
            });
            result = await attempt(repairTemp(round));
            continue;
          }
          log.info(`\n[chorale] ✓ review gate: no blocking findings\n`);
        }
        // A diagnosed repair succeeded → the fix worked; learn it.
        if (learnStore && pending.length) { for (const p of pending) learnStore.record(agent.name, p.key, p.lesson, true); pending = []; }
        log.info(
          round > 0
            ? `\n[chorale] ✓ verified + ran clean after ${round} fix round(s)\n`
            : `\n[chorale] ✓ code verified + ran clean\n`,
        );
        break;
      }
      if (isLast) {
        if (learnStore && pending.length) { for (const p of pending) learnStore.record(agent.name, p.key, p.lesson, false); pending = []; }
        log.info(`\n[chorale] ⚠ ${issues.length} ${kind} issue(s) remain after ${maxRounds} rounds\n`);
        break;
      }
      log.info(`\n[chorale] ⚠ ${kind} found ${issues.length} issue(s) — asking the model to fix…\n`);
      opts.onEvent?.({ type: kind.startsWith("runtime") ? "heal" : "verify", text: `${issues.length} issue(s) — repairing` });
      for (const i of issues.slice(0, 6)) log.info(`    ${i.file}: ${i.message}\n`);
      messages.push({ role: "assistant", content: result.text || "(wrote files)" });
      messages.push({ role: "user", content: feedback });
      // Remember which diagnoses we're betting on, to score next round.
      if (learnStore) pending = matchDiagnoses(issues.map((i) => i.message)).map((d) => ({ key: d.key, lesson: d.hint }));
      result = await attempt(repairTemp(round));
    }

    // Self-critique pass: re-examine the draft, prune unsupported severe findings
    // (precision) and re-scan for misses (recall), then emit the corrected answer.
    if (critique && result.text.trim()) {
      const draft = result.text;
      messages.push({ role: "assistant", content: draft });
      messages.push({ role: "user", content: SELF_CRITIQUE_PROMPT });
      opts.onEvent?.({ type: "verify", text: "self-critique — validating findings" });
      log.debug(`\n[chorale] self-critique pass…\n`);
      suppressOutput = false; // the corrected answer is the visible output
      try {
        result = await attempt();
        // Self-learn: a security class the critique surfaced but the draft missed is a
        // sound "I overlooked this" signal — record it so future reviews scan for it.
        if (learnStore) {
          const before = securityClassesIn(draft);
          for (const cls of REVIEW_LESSON_CLASSES) {
            if (!before.has(cls.key) && securityClassesIn(result.text).has(cls.key)) {
              learnStore.record(agent.name, cls.key, `Always scan for ${cls.label} — a first-pass review missed it before.`, true);
            }
          }
        }
      } catch (err) {
        // Whole chain failed on the critique call — keep the draft rather than lose the answer.
        const msg = err instanceof Error ? err.message : String(err);
        log.info(`\n[chorale] self-critique pass failed (${msg}) — keeping the draft answer\n`);
        if (opts.onToken) opts.onToken(draft);
        else if (stream) process.stdout.write(draft + "\n");
        result = { ...result, text: draft };
      }
    }

    // Report cumulative usage across all attempts (undefined if no provider reported any).
    if (sawUsage) {
      result.usage = { ...(result.usage ?? {}), inputTokens: cumInput, outputTokens: cumOutput, totalTokens: cumTotal } as LanguageModelUsage;
    }
    return result;
  } finally {
    await mcp.close();
  }
}

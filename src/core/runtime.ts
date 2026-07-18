import { streamText, stepCountIs, NoSuchToolError } from "ai";
import type { LanguageModelUsage, ToolSet } from "ai";
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
import { createGateTool } from "../tools/gate-tool.js";
import { createPlanTool } from "../tools/plan-tool.js";
import { parsePlan, validatePlan, planFeedback, formatPlan, type Plan } from "./plan.js";
import { executePlan, type StepRunner } from "./plan-exec.js";
import { extractContract, formatContract, hasContract, type SourceFile } from "./contract.js";
import { formatDesignContract, hasDesignContract, contractDrift, driftDirective } from "./design-contract.js";
import { checkRunnable, tiersOf, directiveFor, planWireUp, scaffoldRoutes, type RunnableIssue } from "./runnable.js";
import { planSkeleton, repairStartScripts } from "./skeleton.js";
import { smokeRun, ensureServerDeps, detectServerEntry } from "./smoke-run.js";
import { runRepairLadder } from "./repair.js";
import { getPlaybook } from "./playbook.js";
import { ensureSeeded } from "./playbook-seed.js";
import { discoverSkills, selectSkills, renderSkillsForPrompt } from "../skills/loader.js";
import { connectMcpServers } from "../mcp/client.js";
import { createTagStripper, TOOL_MARKUP_TOKENS } from "./stream-filter.js";
import { verifyFiles, verifyFeedback } from "./verify.js";
import { smokeTest, smokeFeedback } from "./smoke.js";
import { checkGroundedness, groundednessFeedback, checkFactsPreserved, meaningFeedback, checkDesignFidelity, fidelityFeedback } from "./ground.js";
import { matchDiagnoses } from "./diagnose.js";
import { chainWith, canRunGate, withGateChain } from "./gate.js";
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
 * Run an allow-listed agent as a GATE: one pass, no self-critique, loop-guarded via the gate
 * chain. Returns the gate agent's text, or a structured refusal reason (already in the chain,
 * depth cap, disabled, unknown/unloadable, or errored). The caller decides how to use the text
 * and how to degrade on refusal. `callerChain` must already include the caller (chainWith).
 */
async function runGate(opts: {
  agentName: string;
  prompt: string;
  callerChain: string[];
  config: ChoraleConfig;
  registry: Registry;
  permissionMode?: PermissionMode;
}): Promise<{ ok: true; text: string; plan?: Plan } | { ok: false; reason: string }> {
  const decision = canRunGate(opts.callerChain, opts.agentName);
  if (!decision.ok) return { ok: false, reason: decision.reason ?? "gate refused" };
  const file = resolve(opts.config.agents.dir, `${opts.agentName}.md`);
  if (!existsSync(file)) return { ok: false, reason: `unknown gate agent "${opts.agentName}"` };
  let spec: AgentSpec;
  try {
    spec = loadAgent(file);
  } catch (e) {
    return { ok: false, reason: `failed to load gate agent "${opts.agentName}": ${e instanceof Error ? e.message : String(e)}` };
  }
  const prevCritique = process.env.CHORALE_NO_CRITIQUE;
  process.env.CHORALE_NO_CRITIQUE = "1"; // one pass, no self-critique
  try {
    const res = await withGateChain(opts.callerChain, () =>
      runAgent({ config: opts.config, registry: opts.registry, agent: spec, prompt: opts.prompt, permissionMode: opts.permissionMode ?? "read-only", stream: process.env.CHORALE_TRACE === "1" }),
    );
    return { ok: true, text: res.text, plan: res.plan };
  } catch (err) {
    return { ok: false, reason: `gate "${opts.agentName}" errored: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    if (prevCritique === undefined) delete process.env.CHORALE_NO_CRITIQUE;
    else process.env.CHORALE_NO_CRITIQUE = prevCritique;
  }
}

/**
 * Review gate: after a coding agent's output verifies clean, ask the `reviewer` agent for a
 * semantic second opinion on the written files and return its BLOCKER/MAJOR finding lines
 * (empty = approved). An instance of the generic gate mechanism (runGate).
 */
async function reviewGateFindings(
  files: string[],
  cwd: string,
  config: ChoraleConfig,
  registry: Registry,
  callerChain: string[],
): Promise<string[]> {
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
  const r = await runGate({ agentName: "reviewer", prompt, callerChain, config, registry, permissionMode: "read-only" });
  if (!r.ok) {
    log.info(`[chorale] review gate skipped: ${r.reason}\n`);
    return []; // a refused/failed gate must not block the coder's result
  }
  log.debug(`[chorale] review gate raw: ${r.text.length} chars · ${r.text.match(/VERDICT:[^\n]*/)?.[0] ?? "(no verdict)"}\n`);
  return r.text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^-?\s*\[\s*(BLOCKER|MAJOR)\s*\]/i.test(l));
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
  /** Gates the agent needed but couldn't run (loop-guarded/refused) — a light advisory
   * signal that bubbles up so a caller can react. Empty/absent when all gates ran. */
  unmetGates?: string[];
  /** The structured plan a planning agent produced this turn (from the `plan` tool, or
   * parsed from its text as a fallback). Absent for non-planning agents. */
  plan?: Plan;
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
/** Extensions whose CONTENT we read (for contract + runnability analysis). */
const CONTRACT_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql"]);
const CONTENT_NAMES = new Set(["package.json", ".env", ".env.example"]);
const CONTRACT_SKIP_DIRS = new Set(["node_modules", ".git", "data", "dist", "build", ".next", "coverage"]);

/**
 * Walk a project directory (bounded, skipping deps) collecting: the CONTENT of source + config
 * files (for contract/runnability analysis) and the PATH of every file (for import/entry resolution).
 */
function collectProject(root: string, maxFiles = 400, maxBytes = 60_000): { files: SourceFile[]; paths: Set<string> } {
  const files: SourceFile[] = [];
  const paths = new Set<string>();
  const walk = (dir: string): void => {
    if (paths.size >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (paths.size >= maxFiles) return;
      const full = resolve(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!CONTRACT_SKIP_DIRS.has(name) && !name.startsWith(".")) walk(full);
        continue;
      }
      const rel = full.slice(root.length + 1).replace(/\\/g, "/");
      paths.add(rel);
      const readable = st.size <= maxBytes && (CONTRACT_EXTS.has(full.slice(full.lastIndexOf(".")).toLowerCase()) || CONTENT_NAMES.has(name));
      if (readable) {
        try {
          files.push({ path: rel, content: readFileSync(full, "utf8") });
        } catch {
          /* skip unreadable */
        }
      }
    }
  };
  walk(root);
  return { files, paths };
}

export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const { config, registry, agent, prompt, modelOverride } = opts;
  const stream = opts.stream ?? true;

  // Full-visibility trace: announce every agent as it starts (entry / delegated / gate), indented
  // by delegation depth, so the whole pipeline is legible on the CLI. Opt-in via CHORALE_TRACE=1.
  if (process.env.CHORALE_TRACE === "1") {
    const depth = opts.depth ?? 0;
    const gateChainEnv = (process.env.CHORALE_GATE_CHAIN ?? "").split(",").filter(Boolean);
    const via = gateChainEnv.length ? `gate of ${gateChainEnv[gateChainEnv.length - 1]}` : depth ? `delegated · depth ${depth}` : "entry";
    const pad = "  ".repeat(depth);
    log.info(`\n${pad}┌─────▶ agent: ${agent.name}  (${via})\n${pad}│ task: ${prompt.replace(/\s+/g, " ").slice(0, 110)}${prompt.length > 110 ? "…" : ""}\n`);
  }

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
  // Original content of edited files (for the scribe's meaning-preservation check).
  const originals = new Map<string, string>();
  // Content the agent reads this turn (the "source of truth" for the design-fidelity check).
  const reads: string[] = [];
  const tools: ToolSet = {
    ...buildToolSet(agent.tools, { mode: permissionMode, cwd, touched, originals, reads }),
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

  // Gates the agent needed but couldn't run this turn (loop-guarded/refused) — surfaced on
  // the result as a light advisory signal (graceful degradation + upward note).
  const unmetGates: string[] = [];
  const myGateChain = chainWith(agent.name);

  // On-demand gates: give the agent a `gate` tool restricted to its permitted gate agents,
  // plus a prompt block naming them. Refusals degrade gracefully and are recorded above.
  let gateBlock = "";
  const onDemandGates = [...new Set((agent.gates ?? []).filter((g) => g.mode === "on-demand").map((g) => g.agent))];
  if (onDemandGates.length > 0) {
    tools.gate = createGateTool({
      allowed: onDemandGates,
      callerChain: myGateChain,
      recordUnmet: (note) => unmetGates.push(note),
      run: (agentName, task, callerChain) => runGate({ agentName, prompt: task, callerChain, config, registry, permissionMode }),
    });
    gateBlock =
      "## Gates you can invoke (via the gate tool)\n" +
      onDemandGates.map((a) => `- ${a}`).join("\n") +
      "\nA gate is an advisory second opinion/plan whose result feeds back into your work. If a gate is refused (loop-guarded), proceed inline and note the unmet need.\n\n";
  }

  // Planning: an agent that lists the `plan` tool emits a structured plan; we capture it here
  // (and fall back to parsing its text). Surfaced on RunResult.plan for a caller/gate to consume.
  let capturedPlan: Plan | null = null;
  if (agent.tools.includes("plan")) {
    tools.plan = createPlanTool({ capture: (p) => (capturedPlan = p) });
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

  // Auto `pre` gates: run a permitted agent (e.g. the planner) BEFORE this agent starts, and
  // fold its result into the prompt so the agent works from it — the guaranteed plan-first path.
  // A trivial decomposition injects nothing (Approach B: the task just proceeds inline). Loop-
  // guarded and cost-degrading: a refused/failed pre-gate is recorded as an unmet need, not fatal.
  let preGateBlock = "";
  let preGatePlan: Plan | null = null;
  for (const pg of (agent.gates ?? []).filter((g) => g.mode === "auto" && g.when === "pre")) {
    const decision = canRunGate(myGateChain, pg.agent);
    if (!decision.ok) {
      if (decision.reason) unmetGates.push(`${pg.agent}: ${decision.reason}`);
      continue;
    }
    const r = await runGate({ agentName: pg.agent, prompt, callerChain: myGateChain, config, registry, permissionMode: "read-only" });
    if (!r.ok) {
      unmetGates.push(`${pg.agent}: ${r.reason}`);
      continue;
    }
    if (r.plan) {
      if (r.plan.complexity === "complex") {
        preGatePlan = r.plan;
        const contractBlock = process.env.CHORALE_NO_CONTRACT !== "1" && hasDesignContract(r.plan.contract) ? `${formatDesignContract(r.plan.contract)}\n\n` : "";
        preGateBlock += `## Plan to follow\nA ${pg.agent} decomposed this task. Execute these steps in order, respecting the dependencies; treat each step's "done when" as its acceptance criterion:\n\n${formatPlan(r.plan)}\n\n${contractBlock}`;
        log.info(`\n[chorale] ✓ plan-first: injected a ${r.plan.steps.length}-step plan\n`);
      } else {
        log.info(`\n[chorale] plan-first: task is simple — proceeding without a formal plan\n`);
      }
    } else if (r.text.trim()) {
      preGateBlock += `## Input from ${pg.agent} (advisory)\n${r.text.trim()}\n\n`;
    }
  }

  // Deterministic plan execution (lever #1, opt-in via CHORALE_PLAN_EXEC): rather than trusting the
  // model to delegate every step of a big plan inside one turn (which overflows its budget and stops
  // partway), run EVERY step in dependency order, delegating each to its assigned specialist and
  // threading prior results forward. The agent's own turn then just synthesizes the final answer.
  let planExecBlock = "";
  if (process.env.CHORALE_PLAN_EXEC === "1" && preGatePlan && agent.tools.includes("delegate")) {
    preGateBlock = ""; // the plan is being executed for real — don't also tell the model to do it
    const canEscalate = process.env.CHORALE_NO_ESCALATE !== "1";
    // Contract-first master switch (lever #1–#5). Off (CHORALE_NO_CONTRACT=1) reverts to pre-contract
    // behavior: no designed-contract threading, no deterministic skeleton/start-script pre-pass, no
    // per-step drift check, and a legacy node-entry boot — the A/B baseline.
    const contractFirst = process.env.CHORALE_NO_CONTRACT !== "1";
    // Lever #5: run a specialist on a task; when `escalate`, force the agent's stronger fallback model
    // (gpt-oss). Compensation applied per step — pay for the strong model only when the cheap one has
    // already failed this step (a no-op or a runnability defect), which is where it earns its cost.
    const runSpecialist = async (agentName: string, task: string, escalate: boolean): Promise<{ ok: boolean; text: string }> => {
      const file = resolve(config.agents.dir, `${agentName}.md`);
      if (!existsSync(file)) return { ok: false, text: `unknown specialist "${agentName}"` };
      let spec: AgentSpec;
      try {
        spec = loadAgent(file);
      } catch (e) {
        return { ok: false, text: `failed to load "${agentName}": ${e instanceof Error ? e.message : String(e)}` };
      }
      const modelOverride = escalate && canEscalate ? resolveModelPlan(spec, config).fallbacks[0] : undefined;
      if (modelOverride) log.info(`[chorale]   ⤴ escalating ${agentName} → ${modelOverride}\n`);
      try {
        const res = await runAgent({
          config,
          registry,
          agent: spec,
          prompt: task,
          modelOverride,
          permissionMode,
          stream: process.env.CHORALE_TRACE === "1",
          depth: (opts.depth ?? 0) + 1,
          delegationPath: [...(opts.delegationPath ?? []), agentName],
        });
        return { ok: true, text: res.text };
      } catch (e) {
        return { ok: false, text: e instanceof Error ? e.message : String(e) };
      }
    };
    const stepRunner: StepRunner = async (agentName, task, step) => {
      const newFiles = step.files.filter((f) => f.status === "new").map((f) => f.path);
      const missing = () => newFiles.filter((p) => !existsSync(resolve(cwd, p)));
      let r = await runSpecialist(agentName, task, false);
      // Verify the step produced its declared `new` files; if it created NONE, retry — ESCALATED,
      // since the cheap model just no-op'd this step.
      if (newFiles.length > 0 && missing().length === newFiles.length) {
        log.info(`[chorale]   ↻ step ${step.id} wrote none of its files — retrying (escalated)\n`);
        r = await runSpecialist(
          agentName,
          `${task}\n\nYou did not create any of the required files. Write the FULL contents of each one now with the write tool (it creates folders automatically — do not use mkdir or bash for this): ${missing().join(", ")}.`,
          true,
        );
      }
      // Per-step verification (lever #4): the moment a step finishes, check the endpoints IT served
      // against the contract — a step that wrote "POST /login" while the contract says "POST
      // /api/auth/login" has drifted, and every later step that calls the contract path would break. Fix
      // it now, while this step's context is fresh, instead of discovering it only at the end. Scoped to
      // the step's own files, and only near-miss drift (a wrong prefix on the same resource) is acted on.
      if (contractFirst && hasDesignContract(preGatePlan!.contract)) {
        const touched = step.files.map((f) => resolve(cwd, f.path)).filter((p) => existsSync(p)).map((p) => ({ path: p, content: readFileSync(p, "utf8") }));
        const served = extractContract(touched).endpoints;
        const drifts = contractDrift(served, preGatePlan!.contract);
        if (drifts.length > 0) {
          log.info(`[chorale]   ⚠ step ${step.id} drifted from the contract: ${drifts.map((d) => `${d.served}≠${d.expected}`).join(", ")} — re-aligning\n`);
          r = await runSpecialist(agentName, `${task}\n\n${driftDirective(drifts)}`, true);
        }
      }
      const still = missing();
      const ok = newFiles.length === 0 || still.length < newFiles.length; // produced at least some deliverable
      return { ok, text: r.text + (still.length ? `\n[incomplete — missing files: ${still.join(", ")}]` : "") };
    };
    log.info(`\n[chorale] ▶ executing ${preGatePlan.steps.length}-step plan deterministically…\n`);
    const results = await executePlan(preGatePlan, stepRunner, {
      goal: prompt,
      onStep: (r, i, total) => log.info(`[chorale]   step ${i + 1}/${total} [${r.agent}] ${r.title} — ${r.ok ? "✓" : "✗ " + r.text.slice(0, 80)}\n`),
      // Shared project contract, two layers threaded into every step:
      //  · the DESIGNED contract (lever #1) — the planner's up-front interface spec (exact endpoints,
      //    module exports, deps, env), injected verbatim into EVERY step as the single source of truth,
      //    so producers and consumers reference the same seams instead of guessing at each other;
      //  · the REACTIVE contract (lever #2) — the real routes/base-URL/tables/exports extracted from the
      //    files built so far, so each next step also matches the actual earlier work.
      context: () => {
        const parts: string[] = [];
        if (contractFirst && hasDesignContract(preGatePlan!.contract)) parts.push(formatDesignContract(preGatePlan!.contract));
        const built = extractContract(collectProject(cwd).files);
        if (hasContract(built)) parts.push(formatContract(built));
        return parts.join("\n\n");
      },
    });
    const failed = results.filter((r) => !r.ok).length;
    log.info(`[chorale] ✓ plan executed: ${results.length - failed}/${results.length} steps ok\n`);

    // Repair ladder (Phase 4 · escalate-last): both gates below hand their failures to the same ladder
    // — recall a known fix from the playbook → research → escalate — instead of jumping to the strong
    // model. The coder's cheap base model is what the capability profile is keyed on; a research
    // researcher agent, if present, unlocks the middle rung.
    const { coderModel, escalateModel } = (() => {
      try {
        const plan = resolveModelPlan(loadAgent(resolve(config.agents.dir, "coder.md")), config);
        return { coderModel: plan.model, escalateModel: plan.fallbacks[0] };
      } catch {
        return { coderModel: "coder", escalateModel: undefined };
      }
    })();
    // A content hash of the project — lets the ladder detect a repair attempt that wrote NOTHING (the
    // model explained instead of writing) and force a write-only retry.
    const projectFingerprint = (): string => {
      let h = 5381;
      for (const f of [...collectProject(cwd).files].sort((a, b) => a.path.localeCompare(b.path))) {
        const s = f.path + "\0" + f.content;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      }
      return String(h >>> 0);
    };
    const researchAgent = ["research", "researcher"].find((n) => existsSync(resolve(config.agents.dir, `${n}.md`)));
    const hasResearch = researchAgent != null;
    // The middle rung: delegate investigation to the research agent (read/search only) and hand its
    // findings back to the coder — so the junior gets a senior's *research*, not just a retry prompt.
    const researchDelegate = researchAgent
      ? async ({ issues, errorText }: { issues: string[]; errorText: string }): Promise<string> => {
          const task =
            `A build is failing and the known fixes did not resolve it. Investigate and return CONCRETE, actionable findings the coder can apply — the root cause, the correct library/API usage, and the exact change to make. Do NOT write files; just report your findings.\n\nFailing checks:\n${issues.map((i) => `- ${i}`).join("\n")}` +
            (errorText && !issues.join("\n").includes(errorText) ? `\n\nError detail:\n${errorText.slice(0, 800)}` : "");
          const res = await runSpecialist(researchAgent, task, false);
          return res.ok ? res.text : "";
        }
      : undefined;
    const projectTag = cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "project";
    const ladderEnabled = process.env.CHORALE_NO_LADDER !== "1";
    if (ladderEnabled) ensureSeeded(getPlaybook()); // never let the playbook be cold — seed known fixes once

    // Runnability gate (lever #3): a build can produce many files and still not run. Statically check
    // the project, then repair TIER BY TIER — foundational issues (a missing server entry) first and in
    // isolation, because everything else (unmounted routers, etc.) cascades from them and can't be fixed
    // until the entry exists. Each tier gets its own scoped ladder run so the one fix that matters isn't
    // buried under seven symptoms.
    if (process.env.CHORALE_NO_RUNCHECK !== "1") {
      const allIssues = (): RunnableIssue[] => {
        const proj = collectProject(cwd);
        return checkRunnable(proj.files, proj.paths);
      };
      // Deterministic skeleton (lever #2): before any check runs, make the mechanical files correct with
      // NO model call — declare every imported/contract package in package.json with a resolvable version
      // range, and put every contract env var in .env. Pre-empts the missing-dependency / missing-env
      // classes at the source (only completes what is missing; never narrows or overwrites values).
      const reconcileSkeleton = (where: string): void => {
        const proj = collectProject(cwd);
        const edits = planSkeleton(proj.files, preGatePlan?.contract);
        for (const e of edits) writeFileSync(resolve(cwd, e.path), e.content, "utf8");
        if (edits.length > 0) log.info(`[chorale] ${where} skeleton: ${edits.map((e) => e.reason).join("; ")}\n`);
      };
      if (contractFirst) reconcileSkeleton("⚙");
      let issues = allIssues();
      if (issues.length === 0) {
        log.info(`[chorale] ✓ runnability check passed\n`);
      } else if (ladderEnabled) {
        log.info(`[chorale] ⚠ runnability: ${issues.length} issue(s) across ${tiersOf(issues).length} tier(s) — repair ladder engaged (foundational first)…\n`);
        for (let pass = 0; pass < 4; pass++) {
          issues = allIssues();
          if (issues.length === 0) break;
          const tier = tiersOf(issues)[0]!; // the most-foundational remaining tier
          const tierKinds = new Set(tier.map((i) => i.kind));

          // Deterministic pre-pass: a start script that runs TypeScript through plain node (the
          // unrunnable-entry class) is a mechanical fix — switch it to tsx. No model call.
          if (contractFirst && (tierKinds.has("unrunnable-entry") || tierKinds.has("broken-start"))) {
            const fixes = repairStartScripts(collectProject(cwd).files);
            for (const e of fixes) writeFileSync(resolve(cwd, e.path), e.content, "utf8");
            if (fixes.length > 0) log.info(`[chorale]   ⚙ ${fixes.map((e) => e.reason).join("; ")}\n`);
            reconcileSkeleton("  ⚙"); // the new tsx devDep must land in package.json too
            if (allIssues().filter((i) => tierKinds.has(i.kind)).length === 0) {
              log.info(`[chorale]   ✓ ${[...tierKinds].join("/")} tier cleared deterministically (no model call)\n`);
              continue;
            }
          }

          // Deterministic pre-pass: the missing-dependency / missing-env classes are pure bookkeeping —
          // reconcile package.json/.env in code first (lever #2/#3), so the model is never asked to do an
          // edit a curated table does perfectly.
          if (contractFirst && (tierKinds.has("missing-dependency") || tierKinds.has("missing-env"))) {
            reconcileSkeleton("  ⚙");
            if (allIssues().filter((i) => tierKinds.has(i.kind)).length === 0) {
              log.info(`[chorale]   ✓ ${[...tierKinds].join("/")} tier cleared deterministically (no model call)\n`);
              continue;
            }
          }

          // Deterministic pre-pass: scaffolding a router from a module's methods and mounting it are
          // mechanical edits the model keeps botching. Do them in code first — scaffold missing routes,
          // then wire every unmounted router into the app — so only genuine generation reaches the model.
          if (tierKinds.has("unmounted-routes") || tierKinds.has("unexposed-feature")) {
            const scaffolds = scaffoldRoutes(collectProject(cwd).files, collectProject(cwd).paths);
            for (const s of scaffolds) writeFileSync(resolve(cwd, s.path), s.content, "utf8");
            if (scaffolds.length > 0) log.info(`[chorale]   ⚙ scaffolded ${scaffolds.length} route file(s): ${scaffolds.map((s) => s.feature).join(", ")}\n`);
            const proj = collectProject(cwd);
            const edits = planWireUp(proj.files, proj.paths);
            for (const e of edits) writeFileSync(resolve(cwd, e.path), e.content, "utf8");
            const mounted = edits.reduce((n, e) => n + e.mounted.length, 0);
            if (mounted > 0) log.info(`[chorale]   ⚙ wire-up mounted ${mounted} router(s)\n`);
            if (allIssues().filter((i) => tierKinds.has(i.kind)).length === 0) {
              log.info(`[chorale]   ✓ ${[...tierKinds].join("/")} tier cleared deterministically (no model call)\n`);
              continue;
            }
          }

          const { text: directive, note } = directiveFor(tier, issues, collectProject(cwd).files);
          const tierMessages = tier.map((i, idx) => i.message + (directive && idx === 0 ? "\n\n" + directive : ""));
          log.info(`[chorale]   ▸ fixing ${tier.length} ${[...tierKinds].join("/")} issue(s)${note}…\n`);
          const r = await runRepairLadder(tierMessages, {
            attempt: ({ instruction, escalate }) => runSpecialist("coder", instruction, escalate),
            recheck: () => allIssues().filter((i) => tierKinds.has(i.kind)).map((i) => i.message), // scoped to THIS tier
            fingerprint: projectFingerprint,
            model: coderModel,
            escalateModel,
            kind: "runnability",
            hasResearch,
            research: researchDelegate,
            canEscalate,
            project: projectTag,
            step: "runnability",
            log: (m) => log.info(`[chorale]   ↳ ${m}\n`),
          });
          if (!r.solved && allIssues().some((i) => tierKinds.has(i.kind))) {
            log.info(`[chorale]   ⚠ could not clear the ${[...tierKinds].join("/")} tier — stopping runnability repair\n`);
            break;
          }
        }
        const remaining = allIssues();
        log.info(remaining.length === 0 ? `[chorale] ✓ runnable (all tiers cleared)\n` : `[chorale] ⚠ ${remaining.length} runnability issue(s) remain after the ladder\n`);
      }
    }

    // Dynamic boot gate (fullstack frontier, opt-in via CHORALE_SMOKE_RUN): actually boot the
    // assembled server and probe it — catches crash-on-boot (e.g. a CJS/ESM export mismatch) and 5xx
    // handler bugs that static checks can't. Best-effort; repaired via the same ladder. Needs deps.
    // The boot gate is a DIAGNOSTIC: it may report, but it must never destroy the build it inspects.
    // (A malformed probe path once threw out of http.request and killed an 89-minute run at the very
    // last step.) Any failure here degrades to "inconclusive" and the run continues.
    if (process.env.CHORALE_SMOKE_RUN === "1") {
      try {
      const bootFiles = collectProject(cwd).files;
      if (!detectServerEntry(bootFiles)) {
        log.info(`[chorale] · boot gate: no bootable server detected — skipped\n`);
      } else {
        const doInstall = process.env.CHORALE_BOOT_INSTALL !== "0";
        // A dependency npm cannot RESOLVE (a hallucinated/nonexistent version) is a repairable code bug
        // — surface it, with npm's real error, so the ladder fixes package.json. A timeout or toolchain
        // failure is NOT a code bug: sending it to the ladder makes the coder chase a package.json bug
        // that doesn't exist (it burned both rungs doing exactly that), so treat it as inconclusive.
        const bootProblems = async (): Promise<string[]> => {
          if (doInstall) {
            const dep = ensureServerDeps(cwd, bootFiles);
            if (!dep.installed && dep.reason !== "already installed") {
              if (dep.kind === "resolution") return [`npm install failed for the backend — npm cannot resolve a dependency: ${dep.reason}. Fix package.json so every dependency and version is a real, published package on npm (remove or correct any invented versions) so it installs cleanly.`];
              if (dep.kind === "native-build") return [`npm install failed for the backend — ${dep.reason}. This is almost always a STALE native dependency whose version predates the running Node: in package.json bump ${dep.failedModule ? `"${dep.failedModule.replace(/@[\d^~].*$/, "")}"` : "the native module"} to a current major that ships a prebuilt binary for Node ${process.versions.node} (e.g. better-sqlite3 to ^12), or switch to a pure-JS / built-in alternative (Node's built-in node:sqlite needs no build). Do not add a C++ toolchain.`];
              return []; // timeout / other — can't boot, but not a code bug to repair
            }
          }
          return (await smokeRun(cwd, bootFiles, contractFirst ? { contractEndpoints: preGatePlan?.contract?.endpoints } : { legacyNodeBoot: true })).map((i) => i.message);
        };
        log.info(`[chorale] · boot gate: installing backend deps + booting…\n`);
        const bootIssues = await bootProblems();
        if (bootIssues.length > 0 && ladderEnabled) {
          log.info(`[chorale] ⚠ boot: ${bootIssues.length} issue(s) — repair ladder engaged…\n`);
          for (const m of bootIssues.slice(0, 4)) log.info(`    ${m.split("\n")[0]}\n`);
          const r = await runRepairLadder(bootIssues, {
            attempt: ({ instruction, escalate }) => runSpecialist("coder", instruction, escalate),
            recheck: bootProblems,
            fingerprint: projectFingerprint,
            model: coderModel,
            escalateModel,
            kind: "boot",
            hasResearch,
            research: researchDelegate,
            canEscalate,
            project: projectTag,
            step: "boot",
            log: (m) => log.info(`[chorale]   ↳ ${m}\n`),
          });
          log.info(r.solved ? `[chorale] ✓ boots + serves after the ${r.rungs.at(-1)?.level} rung\n` : `[chorale] ⚠ ${r.remaining.length} boot issue(s) remain after the ladder\n`);
        } else if (bootIssues.length === 0) {
          // Only claim "serves" if deps were genuinely available to boot with — never a false pass.
          const dep = doInstall ? ensureServerDeps(cwd, bootFiles) : { installed: true, reason: "" };
          const ready = !doInstall || dep.installed || dep.reason === "already installed";
          log.info(ready ? `[chorale] ✓ dynamic boot: server installs, starts and serves\n` : `[chorale] · boot gate: inconclusive — backend deps unavailable (${dep.reason})\n`);
        }
      }
      } catch (e) {
        log.info(`[chorale] · boot gate: inconclusive — the check itself failed (${e instanceof Error ? e.message : String(e)})\n`);
      }
    }

    planExecBlock =
      "## The plan has already been executed by specialists\nEach step below was carried out. Write the user a concise final summary of what was built (and note any failed step); do NOT re-delegate or redo the work.\n\n" +
      results.map((r) => `- ${r.id} [${r.agent}] ${r.title}: ${r.ok ? r.text.replace(/\s+/g, " ").slice(0, 300) : "FAILED — " + r.text.slice(0, 200)}`).join("\n") +
      "\n\n";
  }

  const today = new Date().toISOString().slice(0, 10);
  const system = `Current date: ${today}.\n\n${planExecBlock}${preGateBlock}${delegateBlock}${gateBlock}${renderSkillsForPrompt(agentSkills)}${agent.system}${fewShotBlock}${lessonsBlock}`;
  const messages: ChatMessage[] = [...(opts.history ?? []), { role: "user", content: prompt }];

  // Self-critique (the reviewer's form of self-healing): after the main turn, feed
  // the draft answer back and ask the model to validate + correct it. The draft is
  // computed silently (suppressOutput) so only the final, corrected answer is shown.
  const critique = agent.selfCritique && process.env.CHORALE_NO_CRITIQUE !== "1";
  let suppressOutput = critique;

  // Review gate: an auto reviewer gate that fires after this agent's code verifies clean —
  // a semantic second opinion that fixes any BLOCKER/MAJOR it finds. Disable with CHORALE_NO_REVIEW_GATE=1.
  // Only fires if running "reviewer" wouldn't loop back into an agent already in the chain;
  // if it's wanted but loop-guarded, record the unmet need (graceful degradation).
  const wantsReviewGate =
    process.env.CHORALE_NO_REVIEW_GATE !== "1" &&
    (agent.gates ?? []).some((g) => g.agent === "reviewer" && g.mode === "auto" && g.when === "post-verify");
  const reviewDecision = wantsReviewGate ? canRunGate(myGateChain, "reviewer") : { ok: false as const };
  const reviewGate = wantsReviewGate && reviewDecision.ok;
  if (wantsReviewGate && !reviewDecision.ok && "reason" in reviewDecision && reviewDecision.reason) {
    unmetGates.push(`reviewer: ${reviewDecision.reason}`);
  }

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
          // Without this the provider's default cap applies and long output is silently truncated
          // mid-token — which is exactly how a complex project's plan died: the JSON just stopped.
          maxOutputTokens: config.defaults.maxOutputTokens,
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
    let meaningWarned = false; // the meaning-preservation nudge fires at most once (it's intent-sensitive)
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
        if (touched.size === 0 && originals.size === 0) break; // a plain answer, nothing written
        const missing = checkGroundedness([...touched], cwd); // invented paths/symbols/scripts — always wrong, loop until fixed
        // Meaning-preservation is intent-sensitive (an intended edit legitimately changes a fact),
        // so nudge at most ONCE and let the model decide, rather than fighting an intentional change.
        const dropped = meaningWarned ? [] : checkFactsPreserved(originals, cwd);
        // Design-fidelity: if the agent read source(s) then authored an HTML artifact, that bespoke
        // document must not invent data numbers absent from the source. (Design mode's grounded edge.)
        const fabricated: string[] = [];
        if (reads.length) {
          for (const f of [...touched].filter((p) => /\.html?$/i.test(p))) {
            try {
              fabricated.push(...checkDesignFidelity(reads, readFileSync(resolve(cwd, f), "utf8")).fabricated);
            } catch {
              /* unreadable — skip */
            }
          }
        }
        const fab = [...new Set(fabricated)];
        if (missing.length === 0 && dropped.length === 0 && fab.length === 0) {
          log.info(round > 0 ? `\n[chorale] ✓ docs grounded after ${round} fix round(s)\n` : `\n[chorale] ✓ docs grounded (references exist, facts preserved)\n`);
          break;
        }
        if (isLast) {
          log.info(`\n[chorale] ⚠ ${missing.length} invented ref(s) + ${dropped.length} dropped fact(s) + ${fab.length} fabricated number(s) remain after ${maxRounds} rounds\n`);
          break;
        }
        const parts: string[] = [];
        if (missing.length) {
          log.info(`\n[chorale] ⚠ groundedness: ${missing.length} invented reference(s) — asking to fix…\n`);
          for (const m of missing.slice(0, 6)) log.info(`    ${m.file}: ${m.ref} (${m.kind})\n`);
          parts.push(groundednessFeedback(missing));
        }
        if (dropped.length) {
          log.info(`\n[chorale] ⚠ meaning: ${dropped.length} technical fact(s) changed by an edit — one-time check…\n`);
          for (const d of dropped.slice(0, 6)) log.info(`    ${d.file}: ${d.fact}\n`);
          parts.push(meaningFeedback(dropped));
          meaningWarned = true; // nudge once; don't re-fight an intentional change
        }
        if (fab.length) {
          log.info(`\n[chorale] ⚠ design fidelity: ${fab.length} fabricated number(s) not in the source — asking to fix…\n`);
          for (const n of fab.slice(0, 8)) log.info(`    ${n}\n`);
          parts.push(fidelityFeedback({ fabricated: fab }));
        }
        opts.onEvent?.({ type: "verify", text: `docs: ${missing.length + dropped.length + fab.length} issue(s) — fixing` });
        messages.push({ role: "assistant", content: result.text || "(wrote docs)" });
        messages.push({ role: "user", content: parts.join("\n\n") });
        result = await attempt(repairTemp(round));
        continue;
      }

      // (1.6) Plan validation — for planning agents (the planner). Validate the captured (or
      // text-parsed) plan against the real repo — assignments, the dependency DAG, ordering, and
      // grounded file references — and loop back to fix issues. The planner's analog of the coder's
      // verify and the scribe's groundCheck: a plan's guarantees are enforced, not just documented.
      if (agent.tools.includes("plan") && process.env.CHORALE_NO_PLAN_CHECK !== "1") {
        const plan = capturedPlan ?? parsePlan(result.text);
        if (!plan) break; // no plan emitted (e.g. a clarifying question) — nothing to validate
        const roster = listAgents(config.agents.dir)
          .filter((a) => a.delegable && a.name !== agent.name)
          .map((a) => a.name);
        const issues = validatePlan(plan, { agents: roster, cwd });
        if (issues.length === 0) {
          log.info(round > 0 ? `\n[chorale] ✓ plan valid after ${round} fix round(s)\n` : `\n[chorale] ✓ plan valid (assignments, DAG, ordering, grounding)\n`);
          break;
        }
        if (isLast) {
          log.info(`\n[chorale] ⚠ ${issues.length} plan issue(s) remain after ${maxRounds} rounds\n`);
          break;
        }
        log.info(`\n[chorale] ⚠ plan: ${issues.length} issue(s) — asking to fix…\n`);
        for (const i of issues.slice(0, 6)) log.info(`    ${i.message}\n`);
        opts.onEvent?.({ type: "verify", text: `plan: ${issues.length} issue(s) — fixing` });
        messages.push({ role: "assistant", content: result.text || "(emitted a plan)" });
        messages.push({ role: "user", content: planFeedback(issues) });
        capturedPlan = null; // force a fresh capture on the repair round (avoid a stale plan)
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
          const findings = await reviewGateFindings([...touched], cwd, config, registry, myGateChain);
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
    // Light-2 signal: surface any gates that were needed but couldn't run (graceful degradation).
    if (unmetGates.length > 0) {
      result.unmetGates = [...new Set(unmetGates)];
      log.info(`\n[chorale] ℹ ${result.unmetGates.length} gate(s) unavailable this turn (handled inline): ${result.unmetGates.join("; ")}\n`);
    }
    // Surface a structured plan from a planning agent: the tool-captured one, else parse its text.
    if (agent.tools.includes("plan")) {
      const plan = capturedPlan ?? parsePlan(result.text);
      if (plan) result.plan = plan;
    }
    return result;
  } finally {
    await mcp.close();
  }
}

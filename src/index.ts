#!/usr/bin/env node
import "dotenv/config";
import readline from "node:readline";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { loadConfig } from "./core/config.js";
import { detectResources, recommendTieredProfile, writeGeneratedProfile, setActiveProfile } from "./core/init.js";
import type { ChoraleConfig } from "./core/config.js";
import { buildRegistry } from "./core/model-registry.js";
import { resolveModelPlan } from "./core/model-policy.js";
import { loadAgent } from "./agents/loader.js";
import type { AgentSpec } from "./agents/loader.js";
import { runAgent } from "./core/runtime.js";
import { SessionStore } from "./core/session.js";
import type { ChatMessage } from "./core/session.js";
import type { PermissionMode } from "./tools/permissions.js";
import { setLogLevel, setLogFile, log } from "./core/log.js";
import { estimateCost } from "./core/costs.js";
import { closeLessonStore } from "./core/lessons.js";
import { checkProviders } from "./core/doctor.js";
import { LessonStore } from "./core/lessons.js";

interface CliArgs {
  agent?: string;
  model?: string;
  resume?: string;
  continueLatest: boolean;
  permissionMode?: PermissionMode;
  profile?: string;
  json: boolean;
  prompt: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
function version(): string {
  try { return (JSON.parse(readFileSync(resolve(HERE, "../package.json"), "utf8")) as { version?: string }).version ?? "0.0.0"; }
  catch { return "0.0.0"; }
}

const HELP = `chorale — a model-agnostic multi-agent CLI

Usage:
  chorale [options] "your prompt"          run a turn (prompt may also be piped via stdin)

Commands:
  tui [--agent <name>]          interactive terminal UI (streaming chat REPL)
  init [--auto]                 detect models + keys, generate a tailored profile
  agents                        list available agents (model · tier · tools)
  profiles [name]               show model-routing profiles and how they resolve
  sessions                      list recent sessions
  sessions rm <id>              delete a session
  sessions prune [--keep N]     keep the N most-recent sessions (default 20)
  cost [session]                token usage + estimated spend per model
  lessons [agent]               show what agents learned from past repairs
  doctor                        ping every configured provider for reachability

Options:
  -a, --agent <name>            which agent (default: general)
  -m, --model <provider:model>  force a model, overriding the agent's
  -p, --profile <name>          use a model-routing profile
  -r, --resume <id>             resume a session   ·   -c, --continue  resume the latest
      --mode <m> | --yolo | --read-only    permission mode (full-auto | auto-edit | read-only)
      --json                    emit {text, model, usage, session} as JSON
  -v, --verbose | -q, --quiet   log level   ·   -V, --version   ·   -h, --help`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function parseArgs(argv: string[]): CliArgs {
  let agent: string | undefined;
  let model: string | undefined;
  let resume: string | undefined;
  let continueLatest = false;
  let permissionMode: PermissionMode | undefined;
  let profile: string | undefined;
  let json = false;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--agent" || arg === "-a") agent = argv[++i];
    else if (arg === "--model" || arg === "-m") model = argv[++i];
    else if (arg === "--resume" || arg === "-r") resume = argv[++i];
    else if (arg === "--continue" || arg === "-c") continueLatest = true;
    else if (arg === "--profile" || arg === "-p") profile = argv[++i];
    else if (arg === "--yolo") permissionMode = "full-auto";
    else if (arg === "--read-only" || arg === "--plan") permissionMode = "read-only";
    else if (arg === "--verbose" || arg === "-v") setLogLevel("debug");
    else if (arg === "--quiet" || arg === "-q") setLogLevel("warn");
    else if (arg === "--json") json = true;
    else if (arg === "--mode") {
      const m = argv[++i];
      if (m === "read-only" || m === "auto-edit" || m === "full-auto") permissionMode = m;
    } else if (arg !== undefined) rest.push(arg);
  }
  return { agent, model, resume, continueLatest, permissionMode, profile, json, prompt: rest.join(" ").trim() };
}

/** Load every agent spec in the agents dir (best-effort). */
function loadAllAgents(dir: string): AgentSpec[] {
  const specs: AgentSpec[] = [];
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return specs;
  }
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    try {
      specs.push(loadAgent(join(dir, f)));
    } catch {
      /* skip malformed */
    }
  }
  return specs;
}

/** Print each profile and the agent→model table it produces. */
function printProfiles(config: ChoraleConfig, only?: string): void {
  const profiles = config.profiles ?? {};
  const names = Object.keys(profiles);
  process.stderr.write(`Active profile: ${config.activeProfile ?? "(none — per-agent.md routing)"}\n\n`);
  if (names.length === 0) {
    process.stderr.write("No profiles defined. Agents use their agent.md model + the base fallback.\n");
    return;
  }
  if (only && !profiles[only]) {
    process.stderr.write(`Profile "${only}" not found. Available: ${names.join(", ")}\n`);
    return;
  }
  const specs = loadAllAgents(config.agents.dir);
  for (const name of only ? [only] : names) {
    const p = profiles[name]!;
    process.stderr.write(`▸ ${name}${name === config.activeProfile ? " (active)" : ""}${p.description ? ` — ${p.description}` : ""}\n`);
    for (const spec of specs) {
      const plan = resolveModelPlan(spec, config, undefined, name);
      process.stderr.write(`    ${spec.name.padEnd(14)}${spec.tier ? ` [${spec.tier}]` : ""} → ${plan.model}\n`);
    }
    process.stderr.write("\n");
  }
}

/** `chorale cost [session]` — aggregate token usage + estimated spend per model. */
function printCost(store: SessionStore, sessionId?: string): void {
  const rows = store.usageByModel(sessionId);
  if (rows.length === 0) {
    process.stderr.write("No usage recorded yet.\n");
    return;
  }
  process.stderr.write(sessionId ? `Token usage for session ${sessionId}:\n\n` : "Token usage across all sessions:\n\n");
  process.stderr.write(`  ${"model".padEnd(46)} ${"reqs".padStart(5)} ${"in tok".padStart(10)} ${"out tok".padStart(10)} ${"est $".padStart(9)}\n`);
  let total = 0;
  let anyUnknown = false;
  for (const r of rows) {
    const cost = estimateCost(r.model, r.input_tokens, r.output_tokens);
    if (cost == null) anyUnknown = true;
    else total += cost;
    const costStr = cost == null ? "?" : `$${cost.toFixed(4)}`;
    process.stderr.write(
      `  ${r.model.slice(0, 46).padEnd(46)} ${String(r.requests).padStart(5)} ${String(r.input_tokens).padStart(10)} ${String(r.output_tokens).padStart(10)} ${costStr.padStart(9)}\n`,
    );
  }
  process.stderr.write(`\n  Estimated total: $${total.toFixed(4)}${anyUnknown ? " (+ unpriced models shown as ?)" : ""}\n`);
  process.stderr.write("  Estimates use built-in rates (src/core/costs.ts) — confirm against your provider's billing.\n");
}

/** `chorale lessons [agent]` — show what agents have learned from past repairs. */
function printLessons(agent?: string): void {
  const store = new LessonStore();
  try {
    const rows = store.list(agent);
    if (rows.length === 0) {
      process.stderr.write("No lessons learned yet — they accrue as the coder repairs its own mistakes.\n");
      return;
    }
    process.stderr.write(agent ? `Lessons for ${agent}:\n\n` : "Lessons learned across agents:\n\n");
    let lastAgent = "";
    for (const r of rows) {
      if (r.agent !== lastAgent) { process.stderr.write(`▸ ${r.agent}\n`); lastAgent = r.agent; }
      process.stderr.write(`    [${r.key}] ${r.wins}/${r.uses} wins  ${r.lesson.slice(0, 120)}\n`);
    }
  } finally {
    store.close();
  }
}

/** `chorale agents` — list available agents with their resolved model, tier, and tools. */
function printAgents(config: ChoraleConfig): void {
  const specs = loadAllAgents(config.agents.dir);
  if (specs.length === 0) {
    process.stderr.write(`No agents found in ${config.agents.dir}.\n`);
    return;
  }
  process.stderr.write("Agents:\n\n");
  for (const s of specs.sort((a, b) => a.name.localeCompare(b.name))) {
    const model = resolveModelPlan(s, config, undefined, undefined).model;
    process.stderr.write(`  ${s.name.padEnd(14)}${s.tier ? `[${s.tier}]`.padEnd(16) : " ".repeat(16)}→ ${model}\n`);
    process.stderr.write(`  ${" ".repeat(14)}${s.description}\n`);
    if (s.tools.length) process.stderr.write(`  ${" ".repeat(14)}tools: ${s.tools.join(", ")}\n`);
    process.stderr.write("\n");
  }
}

/** `chorale doctor` — ping every configured provider and report reachability. */
async function runDoctor(config: ChoraleConfig): Promise<void> {
  process.stderr.write("Provider health check…\n\n");
  const rows = await checkProviders(config);
  if (rows.length === 0) {
    process.stderr.write("No providers configured.\n");
    return;
  }
  for (const r of rows) {
    process.stderr.write(`  ${r.ok ? "✓" : "✗"} ${r.name.padEnd(12)} ${r.api.padEnd(18)} ${r.detail}${r.ms ? ` (${r.ms}ms)` : ""}\n`);
  }
  const down = rows.filter((r) => !r.ok).length;
  process.stderr.write(`\n${rows.length - down}/${rows.length} reachable.${down ? " Check the key/URL for the ✗ providers." : ""}\n`);
}

function printSessions(store: SessionStore): void {
  const rows = store.listSessions(20);
  if (rows.length === 0) {
    process.stderr.write("No sessions yet.\n");
    return;
  }
  process.stderr.write("Recent sessions (newest first):\n");
  for (const s of rows) {
    process.stderr.write(`  ${s.id}  [${s.agent}]  ${s.title ?? "(untitled)"}\n`);
  }
  process.stderr.write(`\nResume:  chorale --resume <id> "..."   ·   latest:  chorale -c "..."\n`);
}

/** `chorale init` — detect models + keys, generate a tailored profile, and (optionally) apply it. */
async function runInit(auto: boolean): Promise<void> {
  const config = loadConfig();
  const res = await detectResources(config);
  const rec = recommendTieredProfile(res);

  process.stderr.write("Chorale setup\n\n");
  process.stderr.write(`  Ollama: ${res.ollamaUp ? (res.ollamaModels.join(", ") || "no models") : "not running"}\n`);
  const keyList = Object.entries(res.keys).filter(([, v]) => v).map(([k]) => k);
  process.stderr.write(`  API keys: ${keyList.length ? keyList.join(", ") : "none"}\n\n`);
  process.stderr.write(`  Recommended mode: ${rec.mode}\n\n`);
  process.stderr.write(`  Generated profile "recommended":\n`);
  process.stderr.write(`    default${" ".repeat(9)}→ ${rec.profile.default}\n`);
  for (const [tier, model] of Object.entries(rec.profile.tiers ?? {})) {
    process.stderr.write(`    ${tier.padEnd(14)}→ ${model}\n`);
  }
  if (rec.pulls.length) {
    process.stderr.write(`\n  Optional — better per-tier local models:\n`);
    for (const p of rec.pulls) process.stderr.write(`    ollama pull ${p}\n`);
  }
  process.stderr.write("\n");

  const configPath = resolve("config/chorale.config.json5");
  const apply = () => {
    writeGeneratedProfile(configPath, "recommended", rec.profile);
    setActiveProfile(configPath, "recommended");
    process.stderr.write(`✓ Wrote profile "recommended" and set it active.\n`);
    process.stderr.write(`  Inspect:  chorale profiles recommended\n`);
  };

  if (auto) {
    apply();
    return;
  }
  if (!process.stdin.isTTY) {
    process.stderr.write("Run `chorale init --auto` to write & activate this profile.\n");
    return;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((r) => rl.question("Write & activate this profile? [Y/n] ", r));
  rl.close();
  if (/^n/i.test(answer.trim())) {
    process.stderr.write("No changes made.\n");
    return;
  }
  apply();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("-h") || argv.includes("--help") || (argv.length === 0 && process.stdin.isTTY)) {
    process.stdout.write(HELP + "\n");
    return;
  }
  if (argv.includes("-V") || argv.includes("--version")) {
    process.stdout.write(`chorale ${version()}\n`);
    return;
  }

  if (argv[0] === "init") {
    await runInit(argv.includes("--auto") || argv.includes("--yes"));
    return;
  }

  if (argv[0] === "agents") {
    printAgents(loadConfig());
    return;
  }

  if (argv[0] === "doctor") {
    await runDoctor(loadConfig());
    return;
  }

  if (argv[0] === "tui") {
    const ai = argv.findIndex((a) => a === "--agent" || a === "-a");
    // Loose type: the TSX module is excluded from the (native TS7) typecheck; it's validated by the esbuild build.
    const mod = (await import("./tui/app.js")) as { startTui: (o: { agent?: string }) => void };
    mod.startTui({ agent: ai >= 0 ? argv[ai + 1] : undefined });
    return;
  }

  if (argv[0] === "sessions") {
    const store = new SessionStore();
    if (argv[1] === "rm" && argv[2]) {
      process.stderr.write(store.deleteSession(argv[2]) ? `Removed session ${argv[2]}.\n` : `Session ${argv[2]} not found.\n`);
    } else if (argv[1] === "prune") {
      const ki = argv.indexOf("--keep");
      const keep = ki >= 0 ? Number(argv[ki + 1]) || 20 : 20;
      process.stderr.write(`Pruned ${store.pruneSessions(keep)} session(s), kept the ${keep} most recent.\n`);
    } else {
      printSessions(store);
    }
    store.close();
    return;
  }

  if (argv[0] === "profiles") {
    printProfiles(loadConfig(), argv[1]);
    return;
  }

  if (argv[0] === "cost") {
    const store = new SessionStore();
    printCost(store, argv[1]);
    store.close();
    return;
  }

  if (argv[0] === "lessons") {
    printLessons(argv[1]);
    return;
  }

  const args = parseArgs(argv);
  let prompt = args.prompt;
  if (!prompt && !process.stdin.isTTY) prompt = (await readStdin()).trim(); // piped prompt
  if (!prompt) {
    process.stdout.write(HELP + "\n");
    process.exit(1);
  }

  const config = loadConfig();
  const registry = buildRegistry(config);
  const store = new SessionStore();

  // Resolve the session, its prior history, and which agent to use.
  let sessionId: string;
  let history: ChatMessage[] = [];
  let agentName = args.agent ?? "general";

  if (args.resume) {
    const s = store.getSession(args.resume);
    if (!s) {
      process.stderr.write(`Session "${args.resume}" not found.\n`);
      process.exit(1);
    }
    sessionId = s.id;
    history = store.getMessages(sessionId);
    if (!args.agent) agentName = s.agent;
  } else if (args.continueLatest) {
    const s = store.latestSession();
    if (!s) {
      process.stderr.write("No sessions to continue.\n");
      process.exit(1);
    }
    sessionId = s.id;
    history = store.getMessages(sessionId);
    if (!args.agent) agentName = s.agent;
  } else {
    sessionId = "";
  }

  const file = resolve(config.agents.dir, `${agentName}.md`);
  if (!existsSync(file)) {
    process.stderr.write(`Agent "${agentName}" not found at ${file}\n`);
    process.exit(1);
  }
  const agent = loadAgent(file);
  if (!sessionId) sessionId = store.createSession(agent.name);

  // Persist a per-session run transcript (full leveled log) for post-hoc debugging.
  if (!process.env.CHORALE_LOG_FILE) setLogFile(resolve("data/logs", `${sessionId}.log`));

  const activeModel = resolveModelPlan(agent, config, args.model, args.profile).model;
  const profileNote = (args.profile ?? config.activeProfile) ? ` profile=${args.profile ?? config.activeProfile}` : "";
  const priorNote = history.length > 0 ? ` (${history.length} prior msgs)` : "";
  log.info(`[chorale] agent=${agent.name} model=${activeModel}${profileNote} session=${sessionId}${priorNote}\n\n`);

  store.appendMessage(sessionId, "user", prompt);
  const result = await runAgent({
    config,
    registry,
    agent,
    prompt,
    history,
    modelOverride: args.model,
    permissionMode: args.permissionMode,
    profile: args.profile,
    stream: args.json ? false : undefined,
  });
  store.appendMessage(sessionId, "assistant", result.text, result.model);

  const { usage } = result;
  if (usage) store.recordUsage(sessionId, result.model, usage.inputTokens ?? 0, usage.outputTokens ?? 0);
  if (args.json) {
    process.stdout.write(JSON.stringify({ text: result.text, model: result.model, usage: usage ?? null, session: sessionId }) + "\n");
  }
  const tokens =
    usage && (usage.inputTokens != null || usage.outputTokens != null)
      ? ` · in=${usage.inputTokens ?? "?"} out=${usage.outputTokens ?? "?"} tokens`
      : "";
  log.info(`\n[chorale] done · model=${result.model}${tokens} · session=${sessionId}\n`);
  store.close();
  closeLessonStore();
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});

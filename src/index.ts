#!/usr/bin/env node
import "dotenv/config";
import readline from "node:readline";
import { resolve, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
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

interface CliArgs {
  agent?: string;
  model?: string;
  resume?: string;
  continueLatest: boolean;
  permissionMode?: PermissionMode;
  profile?: string;
  prompt: string;
}

function parseArgs(argv: string[]): CliArgs {
  let agent: string | undefined;
  let model: string | undefined;
  let resume: string | undefined;
  let continueLatest = false;
  let permissionMode: PermissionMode | undefined;
  let profile: string | undefined;
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
    else if (arg === "--mode") {
      const m = argv[++i];
      if (m === "read-only" || m === "auto-edit" || m === "full-auto") permissionMode = m;
    } else if (arg !== undefined) rest.push(arg);
  }
  return { agent, model, resume, continueLatest, permissionMode, profile, prompt: rest.join(" ").trim() };
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

  if (argv[0] === "init") {
    await runInit(argv.includes("--auto") || argv.includes("--yes"));
    return;
  }

  if (argv[0] === "sessions") {
    const store = new SessionStore();
    printSessions(store);
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

  const args = parseArgs(argv);
  if (!args.prompt) {
    process.stderr.write(
      'Usage: chorale [--agent <name>] [--model <provider:model>] [--profile <name>] [--resume <id> | -c] [-v|--quiet] "your prompt"\n' +
        "       chorale init   ·   chorale sessions   ·   chorale profiles [name]   ·   chorale cost [session]\n",
    );
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

  store.appendMessage(sessionId, "user", args.prompt);
  const result = await runAgent({
    config,
    registry,
    agent,
    prompt: args.prompt,
    history,
    modelOverride: args.model,
    permissionMode: args.permissionMode,
    profile: args.profile,
  });
  store.appendMessage(sessionId, "assistant", result.text, result.model);

  const { usage } = result;
  if (usage) store.recordUsage(sessionId, result.model, usage.inputTokens ?? 0, usage.outputTokens ?? 0);
  const tokens =
    usage && (usage.inputTokens != null || usage.outputTokens != null)
      ? ` · in=${usage.inputTokens ?? "?"} out=${usage.outputTokens ?? "?"} tokens`
      : "";
  log.info(`\n[chorale] done · model=${result.model}${tokens} · session=${sessionId}\n`);
  store.close();
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});

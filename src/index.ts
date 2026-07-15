#!/usr/bin/env node
import "dotenv/config";
import readline from "node:readline";
import { resolve, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { loadConfig } from "./core/config.js";
import { detectResources, recommendProfile, missingLocalModels, setActiveProfile } from "./core/init.js";
import type { ChoraleConfig } from "./core/config.js";
import { buildRegistry } from "./core/model-registry.js";
import { resolveModelPlan } from "./core/model-policy.js";
import { loadAgent } from "./agents/loader.js";
import type { AgentSpec } from "./agents/loader.js";
import { runAgent } from "./core/runtime.js";
import { SessionStore } from "./core/session.js";
import type { ChatMessage } from "./core/session.js";
import type { PermissionMode } from "./tools/permissions.js";

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

/** `chorale init` — detect models + keys, recommend a profile, and (optionally) apply it. */
async function runInit(auto: boolean): Promise<void> {
  const config = loadConfig();
  const res = await detectResources(config);
  const rec = recommendProfile(res);

  process.stderr.write("Chorale setup\n\n");
  process.stderr.write(
    `  Ollama: ${res.ollamaUp ? `running — ${res.ollamaModels.length ? res.ollamaModels.join(", ") : "no models"}` : "not running"}\n`,
  );
  const keyList = Object.entries(res.keys).filter(([, v]) => v).map(([k]) => k);
  process.stderr.write(`  API keys: ${keyList.length ? keyList.join(", ") : "none"}\n\n`);
  process.stderr.write(`  Recommended profile: ${rec.profile}\n    ${rec.reason}\n`);
  if (rec.localModel) process.stderr.write(`    local model: ${rec.localModel}\n`);
  const missing = missingLocalModels(config, rec.profile, res.ollamaModels);
  if (missing.length) {
    process.stderr.write(`    ⚠ references local models you don't have: ${missing.join(", ")}\n`);
    process.stderr.write(`      (pull with 'ollama pull <name>' or edit the profile's model refs)\n`);
  }
  process.stderr.write("\n");

  const configPath = resolve("config/chorale.config.json5");
  const apply = () => {
    setActiveProfile(configPath, rec.profile);
    process.stderr.write(`✓ Set activeProfile = "${rec.profile}".\n`);
    process.stderr.write(`  Inspect it:  chorale profiles ${rec.profile}\n`);
  };

  if (auto) {
    apply();
    return;
  }
  if (!process.stdin.isTTY) {
    process.stderr.write("Run `chorale init --auto` to apply, or answer the prompt in an interactive terminal.\n");
    return;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((r) => rl.question(`Apply profile "${rec.profile}"? [Y/n] `, r));
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

  const args = parseArgs(argv);
  if (!args.prompt) {
    process.stderr.write(
      'Usage: chorale [--agent <name>] [--model <provider:model>] [--profile <name>] [--resume <id> | -c] "your prompt"\n' +
        "       chorale init   ·   chorale sessions   ·   chorale profiles [name]\n",
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

  const activeModel = resolveModelPlan(agent, config, args.model, args.profile).model;
  const profileNote = (args.profile ?? config.activeProfile) ? ` profile=${args.profile ?? config.activeProfile}` : "";
  const priorNote = history.length > 0 ? ` (${history.length} prior msgs)` : "";
  process.stderr.write(`[chorale] agent=${agent.name} model=${activeModel}${profileNote} session=${sessionId}${priorNote}\n\n`);

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
  const tokens =
    usage && (usage.inputTokens != null || usage.outputTokens != null)
      ? ` · in=${usage.inputTokens ?? "?"} out=${usage.outputTokens ?? "?"} tokens`
      : "";
  process.stderr.write(`\n[chorale] done · model=${result.model}${tokens} · session=${sessionId}\n`);
  store.close();
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});

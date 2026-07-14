#!/usr/bin/env node
import "dotenv/config";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "./core/config.js";
import { buildRegistry, resolveRef } from "./core/model-registry.js";
import { loadAgent } from "./agents/loader.js";
import { runAgent } from "./core/runtime.js";
import { SessionStore } from "./core/session.js";
import type { ChatMessage } from "./core/session.js";

interface CliArgs {
  agent?: string;
  model?: string;
  resume?: string;
  continueLatest: boolean;
  prompt: string;
}

function parseArgs(argv: string[]): CliArgs {
  let agent: string | undefined;
  let model: string | undefined;
  let resume: string | undefined;
  let continueLatest = false;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--agent" || arg === "-a") agent = argv[++i];
    else if (arg === "--model" || arg === "-m") model = argv[++i];
    else if (arg === "--resume" || arg === "-r") resume = argv[++i];
    else if (arg === "--continue" || arg === "-c") continueLatest = true;
    else if (arg !== undefined) rest.push(arg);
  }
  return { agent, model, resume, continueLatest, prompt: rest.join(" ").trim() };
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv[0] === "sessions") {
    const store = new SessionStore();
    printSessions(store);
    store.close();
    return;
  }

  const args = parseArgs(argv);
  if (!args.prompt) {
    process.stderr.write(
      'Usage: chorale [--agent <name>] [--model <provider:model>] [--resume <id> | -c] "your prompt"\n' +
        "       chorale sessions\n",
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

  const activeModel = resolveRef(args.model ?? agent.model, config);
  const priorNote = history.length > 0 ? ` (${history.length} prior msgs)` : "";
  process.stderr.write(`[chorale] agent=${agent.name} model=${activeModel} session=${sessionId}${priorNote}\n\n`);

  store.appendMessage(sessionId, "user", args.prompt);
  const result = await runAgent({
    config,
    registry,
    agent,
    prompt: args.prompt,
    history,
    modelOverride: args.model,
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

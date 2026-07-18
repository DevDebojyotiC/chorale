/**
 * Electron main process. It hosts the chorale core (config, registry, agents, `runAgent`, stores) and
 * exposes it to the renderer ONLY through the typed IPC channels in shared/ipc.ts — the renderer runs
 * with contextIsolation on and no Node access. `runAgent`'s onToken/onEvent stream back over `run:msg`.
 *
 * Built to desktop/dist/main.cjs by build-main.mjs (esbuild); npm deps stay external so Electron's Node
 * loads them (including the native better-sqlite3). Launch with cwd = project root so config/ + agents/
 * + .env resolve.
 */
import "dotenv/config";
import { app, BrowserWindow, ipcMain } from "electron";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry, type Registry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { resolveModelPlan } from "../src/core/model-policy.js";
import { runAgent } from "../src/core/runtime.js";
import { setLogLevel } from "../src/core/log.js";
import { SessionStore } from "../src/core/session.js";
import type { ChoraleConfig } from "../src/core/config.js";
import { IPC, type AgentSummary, type ConfigSummary, type RunRequest, type RunMsg, type SessionInfo, type ChatTurn } from "./shared/ipc.js";

setLogLevel("warn"); // pipeline diagnostics go to the terminal; the UI shows the activity rail

let config: ChoraleConfig;
let registry: Registry;
/** Best-effort — null if better-sqlite3 didn't load (e.g. not rebuilt for Electron). The app still
 *  runs and chats; it just won't persist sessions. The core already guards its own lesson-store. */
let store: SessionStore | null = null;

function initCore(): void {
  config = loadConfig();
  config.agents.dir = resolve(process.cwd(), config.agents.dir); // absolute — robust to cwd
  registry = buildRegistry(config);
  try {
    store = new SessionStore();
  } catch {
    store = null; // sessions won't persist; everything else works
  }
}

const agentFiles = (): string[] =>
  readdirSync(config.agents.dir).filter((f) => f.endsWith(".md") && !f.endsWith(".examples.md"));

function agentSummary(file: string): AgentSummary {
  const spec = loadAgent(resolve(config.agents.dir, file));
  const plan = resolveModelPlan(spec, config);
  return {
    name: spec.name,
    description: spec.description,
    model: plan.model,
    fallbacks: plan.fallbacks,
    tools: spec.tools,
    tier: spec.tier ?? null,
    toggles: {
      verify: spec.verify,
      selfHeal: spec.selfHeal,
      reviewGate: spec.reviewGate,
      selfLearn: spec.selfLearn,
      fewShot: spec.fewShot,
      selfCritique: spec.selfCritique,
      groundCheck: spec.groundCheck,
      delegable: spec.delegable,
    },
  };
}

function registerIpc(): void {
  ipcMain.handle(IPC.agentsList, (): AgentSummary[] => agentFiles().map(agentSummary));

  ipcMain.handle(IPC.configGet, (): ConfigSummary => {
    const providers = Object.entries(config.providers).map(([name, p]) => ({
      name,
      api: p.api,
      baseUrl: p.baseUrl ?? null,
      hasKey: Boolean(p.apiKey && p.apiKey.trim()), // loadConfig already env-expanded ${VARS}
    }));
    const routing = agentFiles().map((f) => {
      const s = agentSummary(f);
      return { agent: s.name, model: s.model, fallbacks: s.fallbacks };
    });
    const d = config.defaults;
    return {
      providers,
      routing,
      defaults: {
        maxOutputTokens: d.maxOutputTokens,
        requestTimeoutMs: d.requestTimeoutMs,
        maxRetries: d.maxRetries,
        maxSteps: d.maxSteps,
        permissions: config.permissions.mode,
      },
      agentsDir: config.agents.dir,
      activeProfile: config.activeProfile ?? null,
    };
  });

  ipcMain.handle(IPC.sessionNew, (_e, agent: string): string => {
    try {
      return store ? store.createSession(agent) : `mem_${Date.now().toString(36)}`;
    } catch {
      return `mem_${Date.now().toString(36)}`;
    }
  });

  ipcMain.handle(IPC.sessionList, (): SessionInfo[] => {
    if (!store) return [];
    return store.listSessions(50).map((s) => ({ id: s.id, agent: s.agent, title: s.title, updatedAt: s.updated_at }));
  });

  ipcMain.handle(IPC.sessionLoad, (_e, id: string): ChatTurn[] => {
    if (!store) return [];
    return store.getMessages(id).map((m) => ({ role: m.role, content: m.content }));
  });

  ipcMain.on(IPC.runStart, async (e, req: RunRequest) => {
    const send = (msg: RunMsg): void => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.runMsg, msg);
    };
    const persist = store && req.sessionId && !req.sessionId.startsWith("mem_") ? store : null;
    try {
      const agent = loadAgent(resolve(config.agents.dir, `${req.agent}.md`));
      persist?.appendMessage(req.sessionId, "user", req.prompt);
      const res = await runAgent({
        config,
        registry,
        agent,
        prompt: req.prompt,
        history: req.history, // prior turns — the agent's memory across the conversation
        onToken: (text) => send({ runId: req.runId, kind: "token", text }),
        onEvent: (ev) => send({ runId: req.runId, kind: "event", eventType: ev.type, text: ev.text }),
      });
      const usage = res.usage ? { inputTokens: res.usage.inputTokens ?? 0, outputTokens: res.usage.outputTokens ?? 0 } : null;
      if (persist) {
        persist.appendMessage(req.sessionId, "assistant", res.text, res.model);
        if (usage) persist.recordUsage(req.sessionId, res.model, usage.inputTokens, usage.outputTokens);
      }
      send({ runId: req.runId, kind: "done", model: res.model, text: res.text, usage });
    } catch (err) {
      send({ runId: req.runId, kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: "#0E1116",
    show: false,
    autoHideMenuBar: true,
    title: "Chorale",
    webPreferences: {
      preload: resolve(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(resolve(__dirname, "renderer/index.html"));
}

app.whenReady().then(() => {
  initCore();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/**
 * Electron main process. It hosts the chorale core (config, registry, agents, `runAgent`, stores) and
 * exposes it to the renderer ONLY through the typed IPC channels in shared/ipc.ts — the renderer runs
 * with contextIsolation on and no Node access. `runAgent`'s onToken/onEvent stream back over `run:msg`.
 *
 * Built to desktop/dist/main.cjs by build-main.mjs (esbuild); npm deps stay external so Electron's Node
 * loads them (including the native better-sqlite3). Launch with cwd = project root so config/ + agents/
 * + .env resolve.
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { resolve, join } from "node:path";
import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import JSON5 from "json5";
import { firstRunSeed, agentCount } from "./workspace.js";
import { envVarOf, upsertEnvVar, readEnvVar, maskKey } from "./settings.js";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry, type Registry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { resolveModelPlan } from "../src/core/model-policy.js";
import { runAgent } from "../src/core/runtime.js";
import { setLogLevel } from "../src/core/log.js";
import { setApprover } from "../src/tools/permissions.js";
import { SessionStore } from "../src/core/session.js";
import type { ChoraleConfig } from "../src/core/config.js";
import { IPC, type AgentSummary, type ConfigSummary, type RunRequest, type RunMsg, type SessionInfo, type ChatTurn, type AppInfo } from "./shared/ipc.js";

setLogLevel("warn"); // pipeline diagnostics go to the terminal; the UI shows the activity rail

let config: ChoraleConfig;
let registry: Registry;
let workspaceDir = process.cwd();
let mainWindow: BrowserWindow | null = null;

/** Pending shell-approval requests, keyed by id → resolve(approved). */
const pendingApprovals = new Map<string, (approved: boolean) => void>();
let approvalSeq = 0;

/** GUI approver: ask the renderer to approve a shell command (auto-edit mode). Denies if no window. */
function guiApprove(question: string): Promise<boolean> {
  const command = (question.match(/\$\s*(.+?)\s*(?:\n|\[y\/N\]|$)/i)?.[1] ?? question).trim();
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(false);
  const id = `perm_${approvalSeq++}`;
  return new Promise<boolean>((resolve) => {
    pendingApprovals.set(id, resolve);
    mainWindow!.webContents.send(IPC.permissionRequest, { id, command });
  });
}
/** Best-effort — null if better-sqlite3 didn't load (e.g. not rebuilt for Electron). The app still
 *  runs and chats; it just won't persist sessions. The core already guards its own lesson-store. */
let store: SessionStore | null = null;

/**
 * Establish the workspace (config/agents/.env/data root), then load .env from it. In dev this is the
 * repo cwd (unchanged). In a packaged app it's a per-user dir under userData, seeded on first launch
 * from the bundled defaults, and we chdir into it so the core's cwd-relative reads land there.
 */
function setupWorkspace(): void {
  if (app.isPackaged) {
    workspaceDir = join(app.getPath("userData"), "workspace");
    try {
      firstRunSeed(workspaceDir, join(process.resourcesPath, "defaults"));
    } catch {
      /* seeding failed — handled by the fallback below */
    }
    if (existsSync(join(workspaceDir, "config", "chorale.config.json5"))) process.chdir(workspaceDir);
    else workspaceDir = process.cwd(); // no seed available — use whatever cwd offers
  } else {
    workspaceDir = process.cwd(); // dev: the repo, unchanged
  }
  loadDotenv({ path: join(workspaceDir, ".env") });
}

function reloadConfig(): void {
  config = loadConfig();
  config.agents.dir = resolve(workspaceDir, config.agents.dir); // absolute — robust to cwd
  registry = buildRegistry(config);
}

function initCore(): void {
  reloadConfig();
  try {
    store = new SessionStore();
  } catch {
    store = null; // sessions won't persist; everything else works
  }
}

const configPath = (): string => join(workspaceDir, "config", "chorale.config.json5");
const envPath = (): string => join(workspaceDir, ".env");
const readEnv = (): string => (existsSync(envPath()) ? readFileSync(envPath(), "utf8") : "");

/** Raw provider apiKey strings (BEFORE env expansion) → so we can recover each provider's ${VAR}. */
function rawProviderKeys(): Record<string, string | undefined> {
  try {
    const raw = JSON5.parse(readFileSync(configPath(), "utf8")) as { providers?: Record<string, { apiKey?: string }> };
    const out: Record<string, string | undefined> = {};
    for (const [name, p] of Object.entries(raw.providers ?? {})) out[name] = p.apiKey;
    return out;
  } catch {
    return {};
  }
}

function buildConfigSummary(): ConfigSummary {
  const raw = rawProviderKeys();
  const envText = readEnv();
  const providers = Object.entries(config.providers).map(([name, p]) => {
    const envVar = envVarOf(raw[name]);
    return {
      name,
      api: p.api,
      baseUrl: p.baseUrl ?? null,
      hasKey: Boolean(p.apiKey && p.apiKey.trim()), // loadConfig already env-expanded ${VARS}
      envVar,
      keyMasked: envVar ? maskKey(readEnvVar(envText, envVar)) : "",
    };
  });
  const routing = agentFiles().map((f) => {
    const s = agentSummary(f);
    return { agent: s.name, model: s.model, fallbacks: s.fallbacks };
  });
  const d = config.defaults;
  return {
    providers,
    routing,
    defaults: { maxOutputTokens: d.maxOutputTokens, requestTimeoutMs: d.requestTimeoutMs, maxRetries: d.maxRetries, maxSteps: d.maxSteps, permissions: config.permissions.mode },
    agentsDir: config.agents.dir,
    activeProfile: config.activeProfile ?? null,
  };
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
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({ workspace: workspaceDir, agents: agentCount(workspaceDir), version: app.getVersion(), packaged: app.isPackaged }));

  ipcMain.handle(IPC.agentsList, (): AgentSummary[] => agentFiles().map(agentSummary));

  ipcMain.handle(IPC.configGet, (): ConfigSummary => buildConfigSummary());

  ipcMain.handle(IPC.settingsSetKey, (_e, envVar: string, value: string): ConfigSummary => {
    const v = value.trim();
    writeFileSync(envPath(), upsertEnvVar(readEnv(), envVar, v));
    if (v) process.env[envVar] = v;
    else delete process.env[envVar];
    reloadConfig(); // re-expand ${envVar} with the new value so hasKey/registry reflect it immediately
    return buildConfigSummary();
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

  ipcMain.on(IPC.permissionResponse, (_e, id: string, approved: boolean) => {
    const resolve = pendingApprovals.get(id);
    if (resolve) {
      pendingApprovals.delete(id);
      resolve(approved);
    }
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
        permissionMode: req.permissionMode,
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
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  mainWindow = win;
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(resolve(__dirname, "renderer/index.html"));
}

app.whenReady().then(() => {
  setupWorkspace();
  initCore();
  registerIpc();
  setApprover(guiApprove); // shell approvals go to the GUI dialog instead of a (nonexistent) TTY
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

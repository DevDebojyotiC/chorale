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
import type { ChoraleConfig } from "../src/core/config.js";
import { IPC, type AgentSummary, type ConfigSummary, type RunRequest, type RunMsg } from "./shared/ipc.js";

setLogLevel("warn"); // pipeline diagnostics go to the terminal; the UI shows the activity rail

let config: ChoraleConfig;
let registry: Registry;

function initCore(): void {
  config = loadConfig();
  config.agents.dir = resolve(process.cwd(), config.agents.dir); // absolute — robust to cwd
  registry = buildRegistry(config);
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

  ipcMain.on(IPC.runStart, async (e, req: RunRequest) => {
    const send = (msg: RunMsg): void => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.runMsg, msg);
    };
    try {
      const agent = loadAgent(resolve(config.agents.dir, `${req.agent}.md`));
      const res = await runAgent({
        config,
        registry,
        agent,
        prompt: req.prompt,
        onToken: (text) => send({ runId: req.runId, kind: "token", text }),
        onEvent: (ev) => send({ runId: req.runId, kind: "event", eventType: ev.type, text: ev.text }),
      });
      send({
        runId: req.runId,
        kind: "done",
        model: res.model,
        text: res.text,
        usage: res.usage ? { inputTokens: res.usage.inputTokens ?? 0, outputTokens: res.usage.outputTokens ?? 0 } : null,
      });
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

/**
 * Electron main process. It hosts the chorale core (config, registry, agents, `runAgent`, stores) and
 * exposes it to the renderer ONLY through the typed IPC channels in shared/ipc.ts — the renderer runs
 * with contextIsolation on and no Node access. `runAgent`'s onToken/onEvent stream back over `run:msg`.
 *
 * Built to desktop/dist/main.cjs by build-main.mjs (esbuild); npm deps stay external so Electron's Node
 * loads them (including the native better-sqlite3). Launch with cwd = project root so config/ + agents/
 * + .env resolve.
 */
import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { resolve, join, relative } from "node:path";
import { readdirSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { config as loadDotenv } from "dotenv";
import JSON5 from "json5";
import { firstRunSeed, agentCount } from "./workspace.js";
import { envVarOf, upsertEnvVar, readEnvVar, maskKey } from "./settings.js";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry, type Registry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { resolveModelPlan } from "../src/core/model-policy.js";
import { runAgent } from "../src/core/runtime.js";
import { setLogLevel, setLogFile } from "../src/core/log.js";
import { setApprover } from "../src/tools/permissions.js";
import { SessionStore } from "../src/core/session.js";
import { estimateCost } from "../src/core/costs.js";
import { getPlaybook } from "../src/core/playbook.js";
import { checkProviders } from "../src/core/doctor.js";
import type { ChoraleConfig } from "../src/core/config.js";
import * as remote from "./remote.js";
import { IPC, type AgentSummary, type ConfigSummary, type RunRequest, type RunMsg, type SessionInfo, type ChatTurn, type AppInfo, type AgentSaveResult, type UsageSummary, type PlaybookItem, type ProviderHealthItem, type DirEntry, type FilePreview, type GitStatus, type GitChange, type FileRef, type RemoteHost, type RemoteHostInput, type RemoteTestResult } from "./shared/ipc.js";

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
  // A packaged app has no terminal, so route diagnostics to a file — otherwise a failure like
  // "no API key set" is invisible and the user only sees the models falling back.
  setLogFile(join(workspaceDir, "data", "logs", "desktop.log"));
  reloadConfig();
  remote.initRemote(workspaceDir);
  try {
    const s = new SessionStore();
    s.listSessions(1); // force the better-sqlite3 native addon to load NOW; a lazy ABI mismatch throws here
    store = s;
  } catch {
    store = null; // SQLite unavailable (e.g. native-ABI mismatch in Electron) — run without persistence
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

/** Summarize an agent, or null if its file won't parse (so one broken agent can't break the roster). */
function safeAgentSummary(file: string): AgentSummary | null {
  try {
    return agentSummary(file);
  } catch {
    return null;
  }
}
const roster = (): AgentSummary[] => agentFiles().map(safeAgentSummary).filter((a): a is AgentSummary => a !== null);

/** Dirs never worth walking for @-mentions (noise + huge). */
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", ".turbo", ".cache", "out", "release", "target", ".venv", "__pycache__"]);

/** Flat, recursive list of files under `root` (relative paths), capped so huge trees stay responsive. */
function walkFiles(root: string, cap = 4000): FileRef[] {
  const out: FileRef[] = [];
  const stack: string[] = [root];
  while (stack.length && out.length < cap) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (out.length >= cap) break;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) stack.push(full);
      } else if (e.isFile()) {
        out.push({ path: full, rel: relative(root, full).split("\\").join("/") });
      }
    }
  }
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

/** Run git in `cwd` and return stdout (throws if git is missing or the command fails). */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 24 * 1024 * 1024, windowsHide: true });
}

/** Parse `git status --porcelain=v1` into typed changes (paths made absolute against the repo root). */
function parseGitStatus(top: string, porcelain: string): GitChange[] {
  const out: GitChange[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) continue;
    const x = line[0]!;
    const y = line[1]!;
    let rel = line.slice(3);
    if (rel.includes(" -> ")) rel = rel.split(" -> ")[1]!; // rename: keep the new path
    if (rel.startsWith('"') && rel.endsWith('"')) rel = rel.slice(1, -1); // git quotes odd paths
    const code = x === "?" ? "?" : x !== " " ? x : y;
    let status: GitChange["status"];
    if (x === "?" || y === "?") status = "untracked";
    else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) status = "conflict";
    else if (code === "A") status = "added";
    else if (code === "D") status = "deleted";
    else if (code === "R") status = "renamed";
    else status = "modified";
    out.push({ path: join(top, rel), file: rel, status, staged: x !== " " && x !== "?" });
  }
  return out;
}

function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({ workspace: workspaceDir, agents: agentCount(workspaceDir), version: app.getVersion(), packaged: app.isPackaged }));

  ipcMain.handle(IPC.agentsList, (): AgentSummary[] => roster());

  ipcMain.handle(IPC.agentSource, (_e, name: string): string => {
    const f = resolve(config.agents.dir, `${name}.md`);
    return existsSync(f) ? readFileSync(f, "utf8") : "";
  });

  ipcMain.handle(IPC.agentSave, (_e, name: string, source: string): AgentSaveResult => {
    const safe = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
    if (!safe) return { ok: false, error: "An agent name is required (letters, numbers, hyphens)." };
    const f = resolve(config.agents.dir, `${safe}.md`);
    try {
      writeFileSync(f, source);
      loadAgent(f); // validate by loading it exactly as the runtime would
      return { ok: true, agents: roster() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(IPC.configGet, (): ConfigSummary => buildConfigSummary());

  ipcMain.handle(IPC.settingsSetKey, (_e, envVar: string, value: string): ConfigSummary => {
    const v = value.trim();
    writeFileSync(envPath(), upsertEnvVar(readEnv(), envVar, v));
    if (v) process.env[envVar] = v;
    else delete process.env[envVar];
    reloadConfig(); // re-expand ${envVar} with the new value so hasKey/registry reflect it immediately
    return buildConfigSummary();
  });

  ipcMain.handle(IPC.pickFolder, async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "Choose a project folder for this session" });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]!;
  });

  ipcMain.handle(IPC.fsReadDir, (_e, dir: string): DirEntry[] | Promise<DirEntry[]> => {
    if (remote.isRemote(dir)) return remote.remoteReadDir(dir);
    try {
      return readdirSync(dir, { withFileTypes: true })
        .map((e) => ({ name: e.name, path: join(dir, e.name), type: (e.isDirectory() ? "dir" : "file") as "file" | "dir" }))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC.fsReadFile, (_e, path: string): FilePreview | Promise<FilePreview> => {
    if (remote.isRemote(path)) return remote.remoteReadFile(path);
    const IMG: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".bmp": "image/bmp" };
    try {
      const st = statSync(path);
      const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
      if (IMG[ext] && st.size <= 3 * 1024 * 1024) return { path, kind: "image", content: `data:${IMG[ext]};base64,${readFileSync(path).toString("base64")}` };
      if (st.size > 512 * 1024) return { path, kind: "toobig", content: `File is ${(st.size / 1024).toFixed(0)} KB — too large to preview.` };
      const buf = readFileSync(path);
      if (buf.subarray(0, 8000).includes(0)) return { path, kind: "binary", content: "Binary file — no preview." };
      return { path, kind: "text", content: buf.toString("utf8") };
    } catch (e) {
      return { path, kind: "error", content: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(IPC.fsListFiles, (_e, folder: string): FileRef[] | Promise<FileRef[]> => {
    if (remote.isRemote(folder)) return remote.remoteListFiles(folder);
    try {
      return existsSync(folder) ? walkFiles(folder) : [];
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC.pickFiles, async (): Promise<string[]> => {
    const res = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], title: "Attach files to this message" });
    return res.canceled ? [] : res.filePaths;
  });

  ipcMain.handle(IPC.remoteList, (): RemoteHost[] => remote.loadHosts());
  ipcMain.handle(IPC.remoteSave, (_e, input: RemoteHostInput): RemoteHost[] => remote.saveHost(input));
  ipcMain.handle(IPC.remoteDelete, (_e, id: string): RemoteHost[] => remote.deleteHost(id));
  ipcMain.handle(IPC.remoteTest, async (_e, id: string): Promise<RemoteTestResult> => {
    const h = remote.loadHosts().find((x) => x.id === id);
    if (!h) return { ok: false, detail: "Host not found.", ms: 0 };
    return remote.testHost(h);
  });
  ipcMain.handle(IPC.remoteHome, async (_e, hostId: string): Promise<string> => remote.remoteUri(hostId, await remote.remoteHome(hostId)));

  ipcMain.handle(IPC.gitStatus, (_e, folder: string): GitStatus | Promise<GitStatus> => {
    if (remote.isRemote(folder)) return remote.remoteGitStatus(folder);
    try {
      const top = git(folder, ["rev-parse", "--show-toplevel"]).trim();
      let branch: string | null = null;
      try {
        branch = git(top, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
      } catch {
        /* detached HEAD / no commits yet */
      }
      const changes = parseGitStatus(top, git(top, ["status", "--porcelain=v1", "-uall"]));
      return { repo: true, branch, changes };
    } catch {
      return { repo: false, branch: null, changes: [] }; // not a repo, or git unavailable
    }
  });

  ipcMain.handle(IPC.gitDiff, (_e, folder: string, file: string): string | Promise<string> => {
    if (remote.isRemote(folder)) return remote.remoteGitDiff(folder, file);
    try {
      const top = git(folder, ["rev-parse", "--show-toplevel"]).trim();
      const rel = relative(top, file).split("\\").join("/");
      let tracked = true;
      try {
        execFileSync("git", ["ls-files", "--error-unmatch", "--", rel], { cwd: top, stdio: "ignore", windowsHide: true });
      } catch {
        tracked = false;
      }
      if (!tracked) {
        // Untracked: synthesize an all-additions diff so the panel shows the new file's content.
        if (!existsSync(file)) return "";
        const st = statSync(file);
        if (st.size > 512 * 1024) return `+ (new file — ${(st.size / 1024).toFixed(0)} KB, too large to preview)`;
        const buf = readFileSync(file);
        if (buf.subarray(0, 8000).includes(0)) return "+ (new binary file — no preview)";
        const lines = buf.toString("utf8").replace(/\n$/, "").split("\n");
        return `--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => "+" + l).join("\n");
      }
      return git(top, ["diff", "HEAD", "--", rel]);
    } catch {
      return "";
    }
  });

  ipcMain.handle(IPC.sessionNew, (_e, agent: string, folder: string | null): string => {
    try {
      return store ? store.createSession(agent, folder) : `mem_${Date.now().toString(36)}`;
    } catch {
      return `mem_${Date.now().toString(36)}`;
    }
  });

  ipcMain.handle(IPC.sessionSetFolder, (_e, id: string, folder: string | null): void => {
    try {
      if (store && !id.startsWith("mem_")) store.setFolder(id, folder);
    } catch {
      /* persistence unavailable */
    }
  });

  ipcMain.handle(IPC.sessionSetTitle, (_e, id: string, title: string | null): void => {
    try {
      if (store && !id.startsWith("mem_")) store.setTitle(id, title && title.trim() ? title.trim() : null);
    } catch {
      /* persistence unavailable */
    }
  });

  ipcMain.handle(IPC.sessionList, (): SessionInfo[] => {
    if (!store) return [];
    return store.listSessions(50).map((s) => ({ id: s.id, agent: s.agent, title: s.title, updatedAt: s.updated_at, folder: s.folder }));
  });

  ipcMain.handle(IPC.sessionLoad, (_e, id: string): ChatTurn[] => {
    if (!store) return [];
    return store.getMessages(id).map((m) => ({ role: m.role, content: m.content }));
  });

  ipcMain.handle(IPC.observeUsage, (): UsageSummary => {
    const rows = (store ? store.usageByModel() : []).map((r) => ({
      model: r.model,
      requests: r.requests,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cost: estimateCost(r.model, r.input_tokens, r.output_tokens),
    }));
    return {
      rows,
      totalIn: rows.reduce((n, r) => n + r.inputTokens, 0),
      totalOut: rows.reduce((n, r) => n + r.outputTokens, 0),
      totalCost: rows.reduce((n, r) => n + (r.cost ?? 0), 0),
    };
  });

  ipcMain.handle(IPC.observePlaybook, (): PlaybookItem[] => {
    try {
      return getPlaybook()
        .entries()
        .map((e) => ({ id: e.id, title: e.title, source: e.source, context: e.context, symptom: e.symptom, solution: e.solution, createdAt: e.createdAt }));
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC.observeDoctor, async (): Promise<ProviderHealthItem[]> => {
    try {
      return await checkProviders(config);
    } catch {
      return [];
    }
  });

  ipcMain.on(IPC.winSetOverlay, (_e, color: string, symbolColor: string) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitleBarOverlay({ color, symbolColor, height: 52 });
    } catch {
      /* platform without overlay support (e.g. macOS) — ignore */
    }
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
      // Remote workspace: the agent's file/shell tools run over SSH in the remote path; local otherwise.
      const rw = req.folder ? remote.parseRemote(req.folder) : null;
      const res = await runAgent({
        config,
        registry,
        agent,
        prompt: req.prompt,
        history: req.history, // prior turns — the agent's memory across the conversation
        permissionMode: req.permissionMode,
        cwd: rw ? rw.path : req.folder && existsSync(req.folder) ? req.folder : undefined, // where the agent works
        backend: rw ? remote.makeToolBackend(rw.host) : undefined, // route tools over SSH when remote
        onToken: (text) => send({ runId: req.runId, kind: "token", text }),
        onEvent: (ev) => send({ runId: req.runId, kind: "event", event: { type: ev.type, text: ev.text, agent: ev.agent, depth: ev.depth, target: ev.target, steps: ev.steps } }),
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
    titleBarStyle: "hidden", // frameless — the app renders its own blended top bar
    titleBarOverlay: { color: "#0e1116", symbolColor: "#8b96a5", height: 52 }, // native min/max/close, blended
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

app.on("before-quit", () => remote.closeAllRemotes());

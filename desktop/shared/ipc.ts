/**
 * The IPC contract between the Electron main process (which owns the chorale core) and the renderer
 * (the React UI). Kept framework-free and dependency-free so both sides import the same types. The
 * renderer never touches the core directly — every read/run goes through these typed channels.
 */

export interface AgentSummary {
  name: string;
  description: string;
  model: string;
  fallbacks: string[];
  tools: string[];
  tier: string | null;
  /** The persona toggles, surfaced as chips in the UI. */
  toggles: {
    verify: boolean;
    selfHeal: boolean;
    reviewGate: boolean;
    selfLearn: boolean;
    fewShot: boolean;
    selfCritique: boolean;
    groundCheck: boolean;
    delegable: boolean;
  };
}

export interface ProviderSummary {
  name: string;
  api: string;
  baseUrl: string | null;
  /** Whether a usable key/token resolved (env-expanded) — drives the status dot. */
  hasKey: boolean;
  /** The ${VAR} this provider's key comes from, or null for local/sentinel providers (no key needed). */
  envVar: string | null;
  /** A masked preview of the current key value (never the full secret). */
  keyMasked: string;
}

export interface RouteRow {
  agent: string;
  model: string;
  fallbacks: string[];
}

export interface ConfigSummary {
  providers: ProviderSummary[];
  routing: RouteRow[];
  defaults: Record<string, string | number>;
  agentsDir: string;
  activeProfile: string | null;
  /** The default model chain every agent inherits: [primary, ...fallbacks] (base.model + base.fallbacks). */
  chain: string[];
}

/** Models a provider can serve, asked live where possible (see `source`). */
export interface ProviderModels {
  provider: string;
  models: string[];
  source: "live" | "catalog";
  error?: string;
}

/** Approval tier the run operates under (mirrors the core's PermissionMode). */
export type PermissionMode = "read-only" | "auto-edit" | "full-auto";

/** A shell command awaiting the user's approval (auto-edit mode). */
export interface PermissionReq {
  id: string;
  command: string;
}

/** One prior conversation turn threaded back into the agent (so it has memory across turns). */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** A run request the renderer sends over `run:start`. */
export interface RunRequest {
  runId: string;
  agent: string;
  prompt: string;
  /** The session this turn belongs to (for persistence); empty when persistence is unavailable. */
  sessionId: string;
  /** Prior turns in this conversation — the agent's memory. */
  history: ChatTurn[];
  /** How much the agent may do this turn. */
  permissionMode: PermissionMode;
  /** The project folder the agent's file/shell tools operate in (null = the default workspace). */
  folder: string | null;
}

/** What the renderer passes to `window.chorale.run` (minus the internal runId). */
export interface RunInput {
  agent: string;
  prompt: string;
  sessionId: string;
  history: ChatTurn[];
  permissionMode: PermissionMode;
  folder: string | null;
}

/** A structured activity event from a run — the orchestrator's + delegated specialists' work. */
export interface ActivityEvent {
  /** tool · salvage · verify · heal · fallback · lesson · delegate · delegate-done · plan */
  type: string;
  text: string;
  /** Which agent produced it (the orchestrator, or a delegated specialist). */
  agent?: string;
  /** Delegation depth: 0 = entry agent, 1 = a specialist it delegated to, … (drives the tree). */
  depth?: number;
  /** For delegate/delegate-done: the specialist being called. */
  target?: string;
  /** For plan: the decomposition, so the UI can show a checklist. */
  steps?: { agent: string; title: string }[];
}

/** Streaming messages the main process pushes back over `run:msg`. */
export type RunMsg =
  | { runId: string; kind: "token"; text: string }
  | { runId: string; kind: "event"; event: ActivityEvent }
  | { runId: string; kind: "done"; model: string; text: string; usage: { inputTokens: number; outputTokens: number } | null }
  | { runId: string; kind: "error"; message: string };

/** Callbacks the renderer passes to `window.chorale.run`. */
export interface RunHandlers {
  onToken?: (text: string) => void;
  onEvent?: (event: ActivityEvent) => void;
  onDone?: (model: string, text: string, usage: { inputTokens: number; outputTokens: number } | null) => void;
  onError?: (message: string) => void;
}

/** Result of saving an agent.md — the file is written, then validated by loading it. */
export interface AgentSaveResult {
  ok: boolean;
  /** A load/parse error to show the user; the file is still written so they can fix it. */
  error?: string;
  /** The refreshed roster (on success). */
  agents?: AgentSummary[];
}

/** One entry in a directory listing (explorer). */
export interface DirEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

/** A file reference for @-mentions — absolute path + repo-relative display path. */
export interface FileRef {
  path: string;
  rel: string;
}

/** A previewed file's content + how to display it. */
export interface FilePreview {
  path: string;
  kind: "text" | "image" | "binary" | "toobig" | "error";
  /** text: the file text · image: a data: URL · others: a short message. */
  content: string;
}

/** One changed file in the session folder's git working tree. */
export interface GitChange {
  /** Absolute path to the file. */
  path: string;
  /** Repo-relative display path. */
  file: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";
  /** Whether the change is staged (in the index). */
  staged: boolean;
}

/** The session folder's git working-tree state (for the changed-files panel). */
export interface GitStatus {
  /** False when the folder isn't a git repo (or git is unavailable). */
  repo: boolean;
  branch: string | null;
  changes: GitChange[];
}

/** A saved SSH host profile (no secrets — auth is via the OpenSSH agent or a key file on disk). */
export interface RemoteHost {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  auth: "agent" | "key";
  privateKeyPath: string | null;
}

/** What the UI submits to create/update a host (id omitted = create). */
export interface RemoteHostInput {
  id?: string;
  label: string;
  host: string;
  port: number;
  username: string;
  auth: "agent" | "key";
  privateKeyPath?: string;
}

/** Result of a connectivity test. */
export interface RemoteTestResult {
  ok: boolean;
  detail: string;
  ms: number;
}

/** App/workspace info for the title bar and status. */
export interface AppInfo {
  workspace: string;
  agents: number;
  version: string;
  packaged: boolean;
}

/** Per-model usage + estimated cost, for the Cost & usage view. */
export interface UsageStat {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}
export interface UsageSummary {
  rows: UsageStat[];
  totalIn: number;
  totalOut: number;
  totalCost: number;
}

/** A learned/seeded fix, for the Playbook view. */
export interface PlaybookItem {
  id: string;
  title: string;
  source: "seeded" | "learned" | "researched";
  context: string;
  symptom: string;
  solution: string;
  createdAt: number;
}

/** Provider reachability, for the Doctor view. */
export interface ProviderHealthItem {
  name: string;
  api: string;
  ok: boolean;
  detail: string;
  ms: number;
}

/** A saved session, for the Sessions list. */
export interface SessionInfo {
  id: string;
  agent: string;
  title: string | null;
  updatedAt: string;
  folder: string | null;
}

/** The API the preload exposes on `window.chorale`. */
export interface ChoraleBridge {
  getAppInfo: () => Promise<AppInfo>;
  listAgents: () => Promise<AgentSummary[]>;
  /** The raw agent.md source (empty string for a new agent). */
  getAgentSource: (name: string) => Promise<string>;
  /** Write agents/<name>.md and validate; returns the refreshed roster or a parse error. */
  saveAgent: (name: string, source: string) => Promise<AgentSaveResult>;
  getConfig: () => Promise<ConfigSummary>;
  /** Open a new session for `agent`; returns its id (a volatile id if persistence is unavailable). */
  /** Write a provider key to the workspace .env and hot-reload; returns the refreshed config. */
  setKey: (envVar: string, value: string) => Promise<ConfigSummary>;
  /** Models a provider can serve — asked live with its configured key, else a curated fallback. */
  listModels: (provider: string) => Promise<ProviderModels>;
  /** Set the default model chain (primary + fallbacks); rewrites the config preserving comments. */
  setModelChain: (chain: string[]) => Promise<ConfigSummary>;
  getUsage: () => Promise<UsageSummary>;
  getPlaybook: () => Promise<PlaybookItem[]>;
  /** On-demand provider reachability check (makes network calls). */
  checkDoctor: () => Promise<ProviderHealthItem[]>;
  /** Open a native folder picker; returns the chosen absolute path, or null if cancelled. */
  pickFolder: () => Promise<string | null>;
  /** List a directory's immediate children (dirs first). Used by the explorer, lazily per folder. */
  readDir: (path: string) => Promise<DirEntry[]>;
  /** Read a file for preview (text, image data URL, or a binary/too-big marker). */
  readFile: (path: string) => Promise<FilePreview>;
  /** Flat, recursive list of files under a folder (for @-mentions); skips .git/node_modules/build dirs. */
  listFiles: (folder: string) => Promise<FileRef[]>;
  /** Open a native multi-file picker; returns the chosen absolute paths (empty if cancelled). */
  pickFiles: () => Promise<string[]>;
  /** Saved SSH host profiles (no secrets). */
  remoteHosts: () => Promise<RemoteHost[]>;
  /** Create or update a host; returns the refreshed list. */
  saveRemoteHost: (input: RemoteHostInput) => Promise<RemoteHost[]>;
  /** Delete a host by id; returns the refreshed list. */
  deleteRemoteHost: (id: string) => Promise<RemoteHost[]>;
  /** Test connectivity to a saved host (connects + runs a trivial command). */
  testRemoteHost: (id: string) => Promise<RemoteTestResult>;
  /** The home directory on a host, as an ssh:// URI (starting point for the remote folder picker). */
  remoteHomeUri: (hostId: string) => Promise<string>;
  /** Git working-tree status for the session folder (changed-files panel). */
  gitStatus: (folder: string) => Promise<GitStatus>;
  /** Unified diff of one file vs HEAD (untracked files come back as an all-additions diff). */
  gitDiff: (folder: string, file: string) => Promise<string>;
  /** Open a new session for `agent` (optionally bound to a project folder); returns its id. */
  newSession: (agent: string, folder?: string | null) => Promise<string>;
  /** Set (or clear) a session's project folder. */
  setSessionFolder: (id: string, folder: string | null) => Promise<void>;
  /** Rename a session (or clear its title with null). */
  setSessionTitle: (id: string, title: string | null) => Promise<void>;
  listSessions: () => Promise<SessionInfo[]>;
  loadSession: (id: string) => Promise<ChatTurn[]>;
  /** Start a streaming turn; returns a cancel function. */
  run: (req: RunInput, handlers: RunHandlers) => () => void;
  /** Recolor the native window-controls overlay to match the current theme (no-op off Electron). */
  setTitleBarOverlay: (color: string, symbolColor: string) => void;
  /** Subscribe to shell-approval requests; returns an unsubscribe. Respond with respondPermission. */
  onPermission: (cb: (req: PermissionReq) => void) => () => void;
  respondPermission: (id: string, approved: boolean) => void;
}

export const IPC = {
  appInfo: "app:info",
  agentsList: "agents:list",
  agentSource: "agents:source",
  agentSave: "agents:save",
  configGet: "config:get",
  settingsSetKey: "settings:set-key",
  modelsList: "models:list",
  modelChainSet: "models:set-chain",
  observeUsage: "observe:usage",
  observePlaybook: "observe:playbook",
  observeDoctor: "observe:doctor",
  sessionNew: "session:new",
  sessionList: "session:list",
  sessionLoad: "session:load",
  sessionSetFolder: "session:set-folder",
  sessionSetTitle: "session:set-title",
  pickFolder: "dialog:pick-folder",
  fsReadDir: "fs:read-dir",
  fsReadFile: "fs:read-file",
  fsListFiles: "fs:list-files",
  pickFiles: "dialog:pick-files",
  gitStatus: "git:status",
  gitDiff: "git:diff",
  remoteList: "remote:list",
  remoteSave: "remote:save",
  remoteDelete: "remote:delete",
  remoteTest: "remote:test",
  remoteHome: "remote:home",
  runStart: "run:start",
  runMsg: "run:msg",
  runCancel: "run:cancel",
  permissionRequest: "permission:request",
  permissionResponse: "permission:response",
  winSetOverlay: "win:set-overlay",
} as const;

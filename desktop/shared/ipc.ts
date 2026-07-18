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
}

/** What the renderer passes to `window.chorale.run` (minus the internal runId). */
export interface RunInput {
  agent: string;
  prompt: string;
  sessionId: string;
  history: ChatTurn[];
  permissionMode: PermissionMode;
}

/** Streaming messages the main process pushes back over `run:msg`. */
export type RunMsg =
  | { runId: string; kind: "token"; text: string }
  | { runId: string; kind: "event"; eventType: string; text: string }
  | { runId: string; kind: "done"; model: string; text: string; usage: { inputTokens: number; outputTokens: number } | null }
  | { runId: string; kind: "error"; message: string };

/** Callbacks the renderer passes to `window.chorale.run`. */
export interface RunHandlers {
  onToken?: (text: string) => void;
  onEvent?: (eventType: string, text: string) => void;
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

/** App/workspace info for the title bar and status. */
export interface AppInfo {
  workspace: string;
  agents: number;
  version: string;
  packaged: boolean;
}

/** A saved session, for the Sessions list. */
export interface SessionInfo {
  id: string;
  agent: string;
  title: string | null;
  updatedAt: string;
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
  newSession: (agent: string) => Promise<string>;
  listSessions: () => Promise<SessionInfo[]>;
  loadSession: (id: string) => Promise<ChatTurn[]>;
  /** Start a streaming turn; returns a cancel function. */
  run: (req: RunInput, handlers: RunHandlers) => () => void;
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
  sessionNew: "session:new",
  sessionList: "session:list",
  sessionLoad: "session:load",
  runStart: "run:start",
  runMsg: "run:msg",
  runCancel: "run:cancel",
  permissionRequest: "permission:request",
  permissionResponse: "permission:response",
} as const;

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
}

/** What the renderer passes to `window.chorale.run` (minus the internal runId). */
export interface RunInput {
  agent: string;
  prompt: string;
  sessionId: string;
  history: ChatTurn[];
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
  getConfig: () => Promise<ConfigSummary>;
  /** Open a new session for `agent`; returns its id (a volatile id if persistence is unavailable). */
  /** Write a provider key to the workspace .env and hot-reload; returns the refreshed config. */
  setKey: (envVar: string, value: string) => Promise<ConfigSummary>;
  newSession: (agent: string) => Promise<string>;
  listSessions: () => Promise<SessionInfo[]>;
  loadSession: (id: string) => Promise<ChatTurn[]>;
  /** Start a streaming turn; returns a cancel function. */
  run: (req: RunInput, handlers: RunHandlers) => () => void;
}

export const IPC = {
  appInfo: "app:info",
  agentsList: "agents:list",
  configGet: "config:get",
  settingsSetKey: "settings:set-key",
  sessionNew: "session:new",
  sessionList: "session:list",
  sessionLoad: "session:load",
  runStart: "run:start",
  runMsg: "run:msg",
  runCancel: "run:cancel",
} as const;

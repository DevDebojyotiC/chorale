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

/** A run request the renderer sends over `run:start`. */
export interface RunRequest {
  runId: string;
  agent: string;
  prompt: string;
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

/** The API the preload exposes on `window.chorale`. */
export interface ChoraleBridge {
  listAgents: () => Promise<AgentSummary[]>;
  getConfig: () => Promise<ConfigSummary>;
  /** Start a streaming turn; returns a cancel function. */
  run: (agent: string, prompt: string, handlers: RunHandlers) => () => void;
}

export const IPC = {
  agentsList: "agents:list",
  configGet: "config:get",
  runStart: "run:start",
  runMsg: "run:msg",
  runCancel: "run:cancel",
} as const;

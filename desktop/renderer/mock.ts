import type { ChoraleBridge, AgentSummary, ConfigSummary, SessionInfo, ChatTurn, RunHandlers, RunInput } from "../shared/ipc";

/**
 * A stand-in for window.chorale used ONLY when the renderer runs in a plain browser (Vite preview),
 * not inside Electron. It returns representative sample data and simulates a streaming run so the UI
 * can be developed and visually verified without the Electron main process. Never used in the packaged
 * app — bridge.ts prefers the real window.chorale whenever it exists.
 */

const AGENTS: AgentSummary[] = [
  { name: "orchestrator", description: "Decomposes a request, delegates to specialists, synthesizes the result.", model: "fireworks:accounts/fireworks/models/gpt-oss-120b", fallbacks: ["puter:z-ai/glm-4.6", "zai:glm-4.5-flash"], tools: ["delegate"], tier: "orchestrator", toggles: { verify: false, selfHeal: false, reviewGate: false, selfLearn: false, fewShot: false, selfCritique: false, groundCheck: false, delegable: false } },
  { name: "coder", description: "Writes and edits code — schema, API, UI, infra, fixes — with verify + self-heal.", model: "fireworks:accounts/fireworks/models/gpt-oss-120b", fallbacks: ["puter:z-ai/glm-4.6"], tools: ["read", "write", "edit", "bash", "grep"], tier: "code", toggles: { verify: true, selfHeal: true, reviewGate: true, selfLearn: true, fewShot: true, selfCritique: false, groundCheck: false, delegable: true } },
  { name: "planner", description: "Turns a goal into a grounded, validated DAG + the up-front interface contract.", model: "fireworks:accounts/fireworks/models/gpt-oss-120b", fallbacks: ["puter:z-ai/glm-4.6"], tools: ["read", "glob", "grep", "plan"], tier: "code", toggles: { verify: false, selfHeal: false, reviewGate: false, selfLearn: true, fewShot: true, selfCritique: false, groundCheck: false, delegable: true } },
  { name: "reviewer", description: "Read-only second opinion — severity-tagged findings with file:line + fix.", model: "fireworks:accounts/fireworks/models/gpt-oss-120b", fallbacks: ["puter:z-ai/glm-4.6"], tools: ["read", "grep", "bash"], tier: "code", toggles: { verify: false, selfHeal: false, reviewGate: false, selfLearn: true, fewShot: true, selfCritique: true, groundCheck: false, delegable: true } },
  { name: "scribe", description: "Grounded docs — README, API, guides; PDF/DOCX/XLSX I/O; anti-hallucination.", model: "fireworks:accounts/fireworks/models/gpt-oss-120b", fallbacks: ["puter:z-ai/glm-4.6"], tools: ["read", "write_doc", "convert"], tier: "docs", toggles: { verify: false, selfHeal: false, reviewGate: false, selfLearn: true, fewShot: true, selfCritique: false, groundCheck: true, delegable: true } },
  { name: "research", description: "Web research and current-information gathering with citations.", model: "fireworks:accounts/fireworks/models/gpt-oss-120b", fallbacks: ["puter:z-ai/glm-4.6"], tools: ["read", "web"], tier: "code", toggles: { verify: false, selfHeal: false, reviewGate: false, selfLearn: true, fewShot: true, selfCritique: false, groundCheck: false, delegable: true } },
  { name: "test-writer", description: "Writes and runs tests for existing code; mutation-graded.", model: "fireworks:accounts/fireworks/models/gpt-oss-120b", fallbacks: ["puter:z-ai/glm-4.6"], tools: ["read", "write", "bash"], tier: "code", toggles: { verify: true, selfHeal: true, reviewGate: false, selfLearn: true, fewShot: true, selfCritique: false, groundCheck: false, delegable: true } },
  { name: "general", description: "Catch-all conversational agent — uses the chorale base model.", model: "ollama:qwen2.5-coder:3b", fallbacks: [], tools: ["read", "web"], tier: null, toggles: { verify: false, selfHeal: true, reviewGate: false, selfLearn: true, fewShot: true, selfCritique: false, groundCheck: false, delegable: true } },
];

const CONFIG: ConfigSummary = {
  providers: [
    { name: "fireworks", api: "openai-compatible", baseUrl: "https://api.fireworks.ai/inference/v1", hasKey: true },
    { name: "puter", api: "puter", baseUrl: null, hasKey: true },
    { name: "zai", api: "openai-compatible", baseUrl: "https://api.z.ai/api/paas/v4", hasKey: true },
    { name: "anthropic", api: "anthropic", baseUrl: null, hasKey: false },
    { name: "ollama", api: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1", hasKey: true },
    { name: "hf", api: "openai-compatible", baseUrl: "https://router.huggingface.co/v1", hasKey: false },
  ],
  routing: AGENTS.map((a) => ({ agent: a.name, model: a.model, fallbacks: a.fallbacks })),
  defaults: { maxOutputTokens: 8192, requestTimeoutMs: 180000, maxRetries: 2, maxSteps: 8, permissions: "auto-edit" },
  agentsDir: "swarm/agents",
  activeProfile: null,
};

const SESSIONS: SessionInfo[] = [
  { id: "s_4f9a2c", agent: "orchestrator", title: "Build BookmarkHub fullstack app", updatedAt: new Date(Date.now() - 6 * 60000).toISOString() },
  { id: "s_1b7d40", agent: "scribe", title: "Draft the API reference", updatedAt: new Date(Date.now() - 3 * 3600000).toISOString() },
  { id: "s_9e0011", agent: "research", title: "Compare free GLM providers", updatedAt: new Date(Date.now() - 2 * 86400000).toISOString() },
];

const REPLY = "I decomposed this into a plan and locked the interface contract up front, so every step builds to the same seams. The backend, auth, and bookmark CRUD are in; I'm wiring the server entry and mounting the routers against the contract paths now.";
const EVENTS: [string, string][] = [
  ["verify", "plan validated & injected · 9 steps · DAG ok"],
  ["tool", "coder wrote src/db/index.ts, src/utils/jwt.ts"],
  ["tool", "skeleton reconciled .env (PORT, JWT_SECRET) — no model call"],
  ["verify", "review gate: 1 finding fixed — express 5 → 4.x"],
  ["fallback", "glm-4.6 no-op → escalating to glm-5.2"],
  ["tool", "writing src/server.ts — mounting /api/auth, /api/bookmarks"],
];

let sessionSeq = 0;

export const mockBridge: ChoraleBridge = {
  listAgents: () => Promise.resolve(AGENTS),
  getConfig: () => Promise.resolve(CONFIG),
  newSession: () => Promise.resolve(`mem_mock_${sessionSeq++}`),
  listSessions: () => Promise.resolve(SESSIONS),
  loadSession: (id): Promise<ChatTurn[]> =>
    Promise.resolve([
      { role: "user", content: `(resumed ${id}) Build BookmarkHub — a fullstack app with JWT auth and bookmark CRUD.` },
      { role: "assistant", content: REPLY },
    ]),
  run: (_req: RunInput, handlers: RunHandlers) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;
    EVENTS.forEach(([type, text], i) => timers.push(setTimeout(() => !cancelled && handlers.onEvent?.(type, text), 250 + i * 550)));
    const words = REPLY.split(" ");
    words.forEach((w, i) => timers.push(setTimeout(() => !cancelled && handlers.onToken?.(w + " "), 400 + i * 45)));
    timers.push(
      setTimeout(
        () => !cancelled && handlers.onDone?.("fireworks:accounts/fireworks/models/gpt-oss-120b", REPLY, { inputTokens: 4820, outputTokens: 1190 }),
        400 + words.length * 45 + 300,
      ),
    );
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  },
};

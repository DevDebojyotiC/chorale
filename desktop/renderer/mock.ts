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
    { name: "fireworks", api: "openai-compatible", baseUrl: "https://api.fireworks.ai/inference/v1", hasKey: true, envVar: "FIREWORKS_API_KEY", keyMasked: "fw-…a1b" },
    { name: "puter", api: "puter", baseUrl: null, hasKey: true, envVar: "PUTER_AUTH_TOKEN", keyMasked: "eyJ…x9z" },
    { name: "zai", api: "openai-compatible", baseUrl: "https://api.z.ai/api/paas/v4", hasKey: true, envVar: "ZAI_API_KEY", keyMasked: "sk-…4f2" },
    { name: "anthropic", api: "anthropic", baseUrl: null, hasKey: false, envVar: "ANTHROPIC_API_KEY", keyMasked: "" },
    { name: "ollama", api: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1", hasKey: true, envVar: null, keyMasked: "" },
    { name: "hf", api: "openai-compatible", baseUrl: "https://router.huggingface.co/v1", hasKey: false, envVar: "HF_TOKEN", keyMasked: "" },
  ],
  routing: AGENTS.map((a) => ({ agent: a.name, model: a.model, fallbacks: a.fallbacks })),
  defaults: { maxOutputTokens: 8192, requestTimeoutMs: 180000, maxRetries: 2, maxSteps: 8, permissions: "auto-edit" },
  agentsDir: "swarm/agents",
  activeProfile: null,
};

const SESSIONS: SessionInfo[] = [
  { id: "s_4f9a2c", agent: "orchestrator", title: "Build BookmarkHub fullstack app", updatedAt: new Date(Date.now() - 6 * 60000).toISOString(), folder: "D:/projects/bookmarkhub" },
  { id: "s_1b7d40", agent: "scribe", title: "Draft the API reference", updatedAt: new Date(Date.now() - 3 * 3600000).toISOString(), folder: null },
  { id: "s_9e0011", agent: "research", title: "Compare free GLM providers", updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(), folder: null },
];

const REPLY = `I decomposed this into a plan and locked the **interface contract** up front, so every step builds to the same seams. Here's the server entry that mounts the routers:

\`\`\`ts
import express from "express";
import { authRouter } from "./api/auth";
import { bookmarksRouter } from "./api/bookmarks";

const app = express();
app.use(express.json());
app.use("/api/auth", authRouter);        // POST /api/auth/register, /login
app.use("/api/bookmarks", bookmarksRouter); // CRUD, JWT-guarded
app.listen(process.env.PORT ?? 3000);
\`\`\`

Next steps:
1. Frontend SPA calling \`/api/auth/login\`
2. Integration tests for the CRUD routes
3. A short \`README\`

Run it with \`npm start\` once the deps install.`;
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
  getAppInfo: () => Promise.resolve({ workspace: "C:/Users/you/AppData/Roaming/Chorale/workspace", agents: AGENTS.length, version: "0.2.0", packaged: false }),
  listAgents: () => Promise.resolve(AGENTS),
  getAgentSource: (name) => {
    const a = AGENTS.find((x) => x.name === name);
    return Promise.resolve(
      a
        ? `---\nname: ${a.name}\ndescription: ${a.description}\nmodel: ${a.model}\nfallbacks: [${a.fallbacks.join(", ")}]\ntier: ${a.tier ?? "other"}\ntools: [${a.tools.join(", ")}]\n---\n\nYou are the ${a.name}. ${a.description}\n`
        : "",
    );
  },
  saveAgent: (_name, _source) => Promise.resolve({ ok: true, agents: AGENTS }),
  getUsage: () =>
    Promise.resolve({
      rows: [
        { model: "fireworks:accounts/fireworks/models/gpt-oss-120b", requests: 42, inputTokens: 148200, outputTokens: 39900, cost: 0.0181 },
        { model: "puter:z-ai/glm-4.6", requests: 8, inputTokens: 21600, outputTokens: 5100, cost: 0 },
        { model: "ollama:qwen2.5-coder:3b", requests: 15, inputTokens: 9800, outputTokens: 4200, cost: 0 },
      ],
      totalIn: 179600,
      totalOut: 49200,
      totalCost: 0.0181,
    }),
  getPlaybook: () =>
    Promise.resolve([
      { id: "p1", title: "ts-node crashes on TypeScript@7 — switch to tsx", source: "seeded", context: "node + esm + typescript", symptom: "Unknown file extension \".ts\"", solution: "Use tsx as the runner (add tsx devDep, start = tsx <entry>); remove ts-node.", createdAt: Date.now() - 3 * 86400000 },
      { id: "p2", title: "better-sqlite3 native build fails — bump to a prebuild major", source: "learned", context: "native module + node 22", symptom: "node-gyp / no prebuilt binary", solution: "Bump better-sqlite3 to ^12 (ships a Node-22 prebuild) or use node:sqlite.", createdAt: Date.now() - 6 * 3600000 },
      { id: "p3", title: "undeclared package crashes at load — add to package.json", source: "learned", context: "express + esm", symptom: "Cannot find package 'ws'", solution: "Add every imported package to dependencies with a valid range before install.", createdAt: Date.now() - 40 * 60000 },
    ]),
  checkDoctor: () =>
    Promise.resolve([
      { name: "fireworks", api: "openai-compatible", ok: true, detail: "200 OK", ms: 210 },
      { name: "puter", api: "puter", ok: true, detail: "reachable", ms: 340 },
      { name: "zai", api: "openai-compatible", ok: true, detail: "200 OK", ms: 180 },
      { name: "anthropic", api: "anthropic", ok: false, detail: "401 — no key", ms: 90 },
      { name: "ollama", api: "openai-compatible", ok: false, detail: "ECONNREFUSED (not running)", ms: 12 },
    ]),
  getConfig: () => Promise.resolve(CONFIG),
  setKey: (envVar, value) =>
    Promise.resolve({
      ...CONFIG,
      providers: CONFIG.providers.map((p) => (p.envVar === envVar ? { ...p, hasKey: !!value.trim(), keyMasked: value.trim() ? value.slice(0, 3) + "…" + value.slice(-3) : "" } : p)),
    }),
  pickFolder: () => Promise.resolve("D:/projects/demo-app"),
  readDir: (path) => {
    const tree: Record<string, { name: string; type: "file" | "dir" }[]> = {
      "D:/projects/demo-app": [
        { name: "src", type: "dir" },
        { name: "public", type: "dir" },
        { name: ".env", type: "file" },
        { name: "package.json", type: "file" },
        { name: "README.md", type: "file" },
        { name: "tsconfig.json", type: "file" },
      ],
      "D:/projects/demo-app/src": [
        { name: "api", type: "dir" },
        { name: "db", type: "dir" },
        { name: "server.ts", type: "file" },
        { name: "utils.ts", type: "file" },
      ],
      "D:/projects/demo-app/src/api": [
        { name: "auth.ts", type: "file" },
        { name: "bookmarks.ts", type: "file" },
      ],
    };
    const norm = path.replace(/[\\/]+$/, "");
    return Promise.resolve((tree[norm] ?? []).map((e) => ({ name: e.name, path: `${norm}/${e.name}`, type: e.type })));
  },
  gitStatus: () =>
    Promise.resolve({
      repo: true,
      branch: "phase-5",
      changes: [
        { path: "D:/projects/demo-app/src/server.ts", file: "src/server.ts", status: "modified" as const, staged: false },
        { path: "D:/projects/demo-app/src/api/auth.ts", file: "src/api/auth.ts", status: "modified" as const, staged: true },
        { path: "D:/projects/demo-app/src/api/bookmarks.ts", file: "src/api/bookmarks.ts", status: "added" as const, staged: false },
        { path: "D:/projects/demo-app/README.md", file: "README.md", status: "untracked" as const, staged: false },
        { path: "D:/projects/demo-app/old.txt", file: "old.txt", status: "deleted" as const, staged: false },
      ],
    }),
  gitDiff: (_folder, file) => {
    if (file.endsWith("server.ts"))
      return Promise.resolve(`diff --git a/src/server.ts b/src/server.ts\nindex 1a2b3c4..5d6e7f8 100644\n--- a/src/server.ts\n+++ b/src/server.ts\n@@ -1,6 +1,8 @@\n import express from "express";\n+import { authRouter } from "./api/auth";\n \n const app = express();\n app.use(express.json());\n+app.use("/api/auth", authRouter);\n-app.listen(3000);\n+app.listen(process.env.PORT ?? 3000);\n`);
    if (file.endsWith("README.md")) return Promise.resolve(`--- /dev/null\n+++ b/README.md\n@@ -0,0 +1,2 @@\n+# demo-app\n+A small express service.\n`);
    return Promise.resolve(`diff --git a/${file} b/${file}\n@@ -1 +1 @@\n-old\n+new\n`);
  },
  readFile: (path) => {
    if (path.endsWith("server.ts"))
      return Promise.resolve({ path, kind: "text" as const, content: `import express from "express";\nimport { authRouter } from "./api/auth";\n\nconst app = express();\napp.use(express.json());\napp.use("/api/auth", authRouter);\napp.listen(process.env.PORT ?? 3000);\n` });
    if (path.endsWith("package.json")) return Promise.resolve({ path, kind: "text" as const, content: `{\n  "name": "demo-app",\n  "type": "module",\n  "scripts": { "start": "tsx src/server.ts" },\n  "dependencies": { "express": "^4.21.2" }\n}\n` });
    return Promise.resolve({ path, kind: "text" as const, content: `// ${path.split("/").pop()}\n(preview)\n` });
  },
  newSession: () => Promise.resolve(`mem_mock_${sessionSeq++}`),
  setSessionFolder: () => Promise.resolve(),
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
  onPermission: (cb) => {
    // Dev helper: call window.__triggerPermission("npm test") in the console to preview the dialog.
    (window as unknown as { __triggerPermission?: (c: string) => void }).__triggerPermission = (command: string) => cb({ id: "mock-perm", command });
    return () => {
      delete (window as unknown as { __triggerPermission?: unknown }).__triggerPermission;
    };
  },
  respondPermission: (id, approved) => console.log("[mock] permission", id, approved ? "approved" : "denied"),
};

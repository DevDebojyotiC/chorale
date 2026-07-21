import { describe, it, expect, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { SessionStore } from "../src/core/session";

const DB = "data/test-sessions.sqlite";

describe("Phase 1 — session store (persist/resume)", () => {
  const store = new SessionStore(DB);

  afterAll(() => {
    store.close();
    for (const ext of ["", "-wal", "-shm"]) {
      try {
        rmSync(DB + ext);
      } catch {
        /* ignore */
      }
    }
  });

  it("creates a session and persists a turn", () => {
    const id = store.createSession("research");
    store.appendMessage(id, "user", "What is Node.js?");
    store.appendMessage(id, "assistant", "A JavaScript runtime.", "hf:qwen");
    const msgs = store.getMessages(id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: "user", content: "What is Node.js?" });
    expect(msgs[0]?.activity).toBeNull(); // a user turn records no activity
    expect(msgs[1]).toMatchObject({ role: "assistant", model: "hf:qwen" });
  });

  it("round-trips an assistant turn's activity JSON (so a reopened session rebuilds it)", () => {
    const id = store.createSession("orchestrator");
    const activity = JSON.stringify([{ type: "delegate", text: "find trends", target: "research", depth: 0 }]);
    store.appendMessage(id, "user", "build it");
    store.appendMessage(id, "assistant", "done", "fireworks:gpt-oss-120b", activity);
    const msgs = store.getMessages(id);
    expect(msgs[1]?.activity).toBe(activity);
    expect(JSON.parse(msgs[1]!.activity!)[0].target).toBe("research");
  });

  it("deleteSession removes the session and its messages", () => {
    const id = store.createSession("coder");
    store.appendMessage(id, "user", "hello");
    expect(store.deleteSession(id)).toBe(true);
    expect(store.getMessages(id)).toHaveLength(0);
    expect(store.listSessions(50).some((s) => s.id === id)).toBe(false);
    expect(store.deleteSession(id)).toBe(false); // already gone
  });

  it("records and aggregates token usage per model", () => {
    const id = store.createSession("coder");
    store.recordUsage(id, "fireworks:accounts/fireworks/models/gpt-oss-120b", 1000, 500);
    store.recordUsage(id, "fireworks:accounts/fireworks/models/gpt-oss-120b", 2000, 400);
    store.recordUsage(id, "ollama:qwen2.5-coder:3b", 300, 100);
    const rows = store.usageByModel(id);
    expect(rows).toHaveLength(2);
    const oss = rows.find((r) => r.model.includes("gpt-oss-120b"));
    expect(oss?.requests).toBe(2);
    expect(oss?.input_tokens).toBe(3000);
    expect(oss?.output_tokens).toBe(900);
  });

  it("titles the session from the first user message", () => {
    const id = store.createSession("general");
    store.appendMessage(id, "user", "Explain closures please");
    expect(store.getSession(id)?.title).toBe("Explain closures please");
  });

  it("returns the latest session by recency", () => {
    const id = store.createSession("coder");
    store.appendMessage(id, "user", "newest");
    expect(store.latestSession()?.id).toBe(id);
  });

  it("resumes history across a new turn", () => {
    const id = store.createSession("general");
    store.appendMessage(id, "user", "turn 1");
    store.appendMessage(id, "assistant", "reply 1");
    const history = store.getMessages(id);
    expect(history).toHaveLength(2);
    // a resumed turn appends onto the same session
    store.appendMessage(id, "user", "turn 2");
    expect(store.getMessages(id)).toHaveLength(3);
  });
});

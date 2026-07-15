import { describe, it, expect } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { isRetriable, capContext, backoffMs, runAgent } from "../src/core/runtime";
import type { ChatMessage } from "../src/core/session";
import type { ChoraleConfig } from "../src/core/config";
import type { AgentSpec } from "../src/agents/loader";
import type { Registry } from "../src/core/model-registry";

describe("network resilience — isRetriable", () => {
  it("retries fast transient failures (429 / 5xx / connection)", () => {
    expect(isRetriable({ statusCode: 429 })).toBe(true);
    expect(isRetriable({ status: 503 })).toBe(true);
    expect(isRetriable(new Error("fetch failed"))).toBe(true);
    expect(isRetriable(new Error("rate limit exceeded"))).toBe(true);
    expect(isRetriable(new Error("read ECONNRESET"))).toBe(true);
  });
  it("does NOT retry timeouts/aborts (a hung provider stays hung) or client errors", () => {
    expect(isRetriable(new Error("The operation was aborted due to timeout"))).toBe(false);
    expect(isRetriable({ name: "TimeoutError", message: "timed out" })).toBe(false);
    expect(isRetriable({ statusCode: 400 })).toBe(false);
    expect(isRetriable(new Error("invalid api key"))).toBe(false);
  });
});

describe("backoffMs", () => {
  it("grows and stays capped", () => {
    expect(backoffMs(0)).toBeGreaterThanOrEqual(500);
    expect(backoffMs(0)).toBeLessThan(800);
    expect(backoffMs(20)).toBeLessThanOrEqual(8000 + 250);
    expect(backoffMs(3)).toBeGreaterThan(backoffMs(0));
  });
});

describe("context guard — capContext", () => {
  it("trims the stale middle, keeping the task and the recent tail under budget", () => {
    const msgs: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({ role: "user", content: "x".repeat(6000) + `#${i}` }));
    const first = msgs[0];
    const last = msgs[29];
    capContext(msgs);
    expect(msgs[0]).toBe(first); // task preserved
    expect(msgs[msgs.length - 1]).toBe(last); // most recent preserved
    expect(msgs.reduce((n, m) => n + (m.content as string).length, 0)).toBeLessThanOrEqual(120_000);
    expect(msgs.length).toBeLessThan(30);
  });
  it("leaves a small conversation untouched", () => {
    const msgs: ChatMessage[] = [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }];
    capContext(msgs);
    expect(msgs).toHaveLength(2);
  });
});

// ---- Orchestration: fallback chain via a mock model ----
function textModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: text },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: "stop", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
        ],
      }),
    }),
  });
}
function errorModel(message: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({ doStream: async () => { throw new Error(message); } });
}

const baseConfig = (): ChoraleConfig => ({
  base: { model: "mock:good", fallbacks: [] },
  providers: {},
  agents: { dir: "agents", enabled: [] },
  skills: { dirs: [] },
  mcp: { servers: {} },
  permissions: { mode: "full-auto" },
  defaults: { maxSteps: 4, maxDelegationDepth: 2, maxVerifyRounds: 3, requestTimeoutMs: 180_000, maxRetries: 2 },
} as unknown as ChoraleConfig);

const agent = (over: Partial<AgentSpec> = {}): AgentSpec => ({
  name: "t", description: "d", model: "mock:bad", fallbacks: ["mock:good"], tools: [], skills: [],
  delegable: false, mcp: [], verify: false, fewShot: false, selfHeal: false, selfLearn: false, tier: undefined, system: "You are a test.", ...over,
});

describe("runAgent — fallback chain (mock model)", () => {
  it("returns the primary model's output when it succeeds", async () => {
    const registry = { languageModel: () => textModel("primary answer") } as unknown as Registry;
    const res = await runAgent({ config: baseConfig(), registry, agent: agent({ model: "mock:good", fallbacks: [] }), prompt: "hi", stream: false });
    expect(res.model).toBe("mock:good");
    expect(res.text).toContain("primary answer");
  });

  it("falls back to the next model when the first errors", async () => {
    const registry = {
      languageModel: (ref: string) => (ref === "mock:bad" ? errorModel("boom") : textModel("hello world")),
    } as unknown as Registry;
    const res = await runAgent({ config: baseConfig(), registry, agent: agent(), prompt: "hi", stream: false });
    expect(res.model).toBe("mock:good");
    expect(res.text).toContain("hello world");
  });

  it("throws a clear error when every model in the chain fails", async () => {
    const registry = { languageModel: () => errorModel("provider down") } as unknown as Registry;
    await expect(
      runAgent({ config: baseConfig(), registry, agent: agent(), prompt: "hi", stream: false }),
    ).rejects.toThrow(/All models in the fallback chain failed/);
  });
});

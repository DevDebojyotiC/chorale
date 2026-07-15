import { describe, it, expect } from "vitest";
import { resolveModelPlan } from "../src/core/model-policy";
import type { ChoraleConfig } from "../src/core/config";
import type { AgentSpec } from "../src/agents/loader";

function agent(name: string, tier?: string, model = "${base}", fallbacks: string[] = []): AgentSpec {
  return {
    name,
    description: "",
    model,
    fallbacks,
    tools: [],
    skills: [],
    delegable: true,
    mcp: [],
    verify: false,
    tier,
    system: "",
  };
}

const cfg = {
  base: { model: "ollama:qwen2.5-coder:3b", fallbacks: [] },
  providers: {},
  agents: { dir: "agents", enabled: [] },
  skills: { dirs: [] },
  mcp: { servers: {} },
  permissions: { mode: "auto-edit" },
  defaults: { maxSteps: 8, maxDelegationDepth: 2, maxVerifyRounds: 3, requestTimeoutMs: 180_000, maxRetries: 2 },
  profiles: {
    "local-single": { default: "ollama:qwen2.5-coder:3b" },
    "local-varied": { default: "ollama:qwen2.5-coder:3b", tiers: { research: "ollama:llama3.2:3b" } },
    hybrid: { default: "ollama:qwen2.5-coder:3b", tiers: { code: "fireworks:glm" }, fallbacks: ["ollama:qwen2.5-coder:3b"] },
    custom: {},
    agentover: { default: "ollama:x", agents: { coder: "fireworks:special" } },
  },
} as unknown as ChoraleConfig;

describe("Phase 2 — model profile resolution", () => {
  it("no profile → agent.md model (${base} → base.model)", () => {
    expect(resolveModelPlan(agent("general", "chat"), cfg).model).toBe("ollama:qwen2.5-coder:3b");
  });

  it("local-single → every agent gets the default", () => {
    expect(resolveModelPlan(agent("coder", "code"), cfg, undefined, "local-single").model).toBe("ollama:qwen2.5-coder:3b");
  });

  it("tier routing: a mapped tier wins, an unmapped tier falls to default", () => {
    expect(resolveModelPlan(agent("research", "research"), cfg, undefined, "local-varied").model).toBe("ollama:llama3.2:3b");
    expect(resolveModelPlan(agent("coder", "code"), cfg, undefined, "local-varied").model).toBe("ollama:qwen2.5-coder:3b");
  });

  it("hybrid: heavy tier → serverless, with profile fallback composed in", () => {
    const plan = resolveModelPlan(agent("coder", "code"), cfg, undefined, "hybrid");
    expect(plan.model).toBe("fireworks:glm");
    expect(plan.fallbacks).toContain("ollama:qwen2.5-coder:3b");
  });

  it("per-agent override beats tier and default", () => {
    expect(resolveModelPlan(agent("coder", "code"), cfg, undefined, "agentover").model).toBe("fireworks:special");
  });

  it("--model beats the profile", () => {
    expect(resolveModelPlan(agent("coder", "code"), cfg, "anthropic:claude-opus-4-8", "hybrid").model).toBe("anthropic:claude-opus-4-8");
  });

  it("empty (custom) profile → each agent.md model wins", () => {
    expect(resolveModelPlan(agent("coder", "code", "hf:special"), cfg, undefined, "custom").model).toBe("hf:special");
  });

  it("fallbacks are deduped and exclude the primary", () => {
    const a = agent("coder", "code", "fireworks:glm", ["ollama:qwen2.5-coder:3b", "ollama:qwen2.5-coder:3b"]);
    const plan = resolveModelPlan(a, cfg, undefined, "hybrid");
    expect(plan.fallbacks).not.toContain("fireworks:glm");
    expect(plan.fallbacks.filter((m) => m === "ollama:qwen2.5-coder:3b")).toHaveLength(1);
  });
});

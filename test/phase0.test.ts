import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/core/config";
import { buildRegistry, resolveRef } from "../src/core/model-registry";
import { loadAgent } from "../src/agents/loader";

describe("Phase 0 — config & registry", () => {
  it("loads and validates the chorale config", () => {
    const config = loadConfig();
    expect(config.base.model).toBe("ollama:qwen2.5-coder:3b");
    expect(config.providers).toHaveProperty("ollama");
    expect(config.providers).toHaveProperty("anthropic");
    expect(config.providers.ollama?.api).toBe("openai-compatible");
  });

  it("resolves the ${base} sentinel to the base model", () => {
    const config = loadConfig();
    expect(resolveRef("${base}", config)).toBe("ollama:qwen2.5-coder:3b");
    expect(resolveRef("anthropic:claude-opus-4-8", config)).toBe("anthropic:claude-opus-4-8");
  });

  it("builds a provider registry from config without throwing", () => {
    const config = loadConfig();
    expect(() => buildRegistry(config)).not.toThrow();
  });

  it("exposes mcp + skills config with sane defaults", () => {
    const config = loadConfig();
    expect(typeof config.mcp.servers).toBe("object");
    expect(config.skills.dirs).toContain("skills");
    expect(config.defaults.maxDelegationDepth).toBeGreaterThanOrEqual(1);
  });

  it("parses the general agent.md", () => {
    const agent = loadAgent("agents/general.md");
    expect(agent.name).toBe("general");
    expect(agent.model).toBe("${base}");
    expect(agent.system.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "vitest";
import { providerUnusable } from "../src/core/model-registry";
import type { ChoraleConfig } from "../src/core/config";

const cfg = (providers: Record<string, { api: string; baseUrl?: string; apiKey?: string }>) =>
  ({ providers }) as unknown as ChoraleConfig;

describe("providerUnusable — actionable pre-flight instead of a bare 401", () => {
  it("flags a configured provider whose key is empty (the packaged first-run state)", () => {
    const c = cfg({ fireworks: { api: "openai-compatible", baseUrl: "https://api.fireworks.ai/inference/v1", apiKey: "" } });
    const msg = providerUnusable(c, "fireworks:accounts/fireworks/models/gpt-oss-120b");
    expect(msg).toMatch(/no API key set for provider "fireworks"/);
    expect(msg).toMatch(/Config/);
  });

  it("treats whitespace-only keys as missing", () => {
    const c = cfg({ zai: { api: "openai-compatible", baseUrl: "https://api.z.ai/v1", apiKey: "   " } });
    expect(providerUnusable(c, "zai:glm-4.5-flash")).toMatch(/no API key/);
  });

  it("passes a configured provider that HAS a key", () => {
    const c = cfg({ fireworks: { api: "openai-compatible", baseUrl: "https://api.fireworks.ai/inference/v1", apiKey: "fw-abc" } });
    expect(providerUnusable(c, "fireworks:some/model")).toBeNull();
  });

  it("never blocks a local runtime (no key needed)", () => {
    const c = cfg({ ollama: { api: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "" } });
    expect(providerUnusable(c, "ollama:qwen2.5-coder:3b")).toBeNull();
  });

  it("does not pre-empt a provider absent from config (custom/injected registry)", () => {
    expect(providerUnusable(cfg({}), "mock:good")).toBeNull();
  });
});

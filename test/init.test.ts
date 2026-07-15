import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recommendProfile, missingLocalModels, setActiveProfile, pickLocalCoder } from "../src/core/init";
import type { Resources } from "../src/core/init";
import type { ChoraleConfig } from "../src/core/config";

const R = (over: Partial<Resources>): Resources => ({
  ollamaUp: false,
  ollamaModels: [],
  keys: { anthropic: false, fireworks: false, hf: false, tavily: false },
  ...over,
});

describe("Phase 2 — init wizard logic", () => {
  it("recommends hybrid when local + serverless are both present", () => {
    const rec = recommendProfile(R({ ollamaUp: true, ollamaModels: ["qwen2.5-coder:3b"], keys: { fireworks: true, anthropic: false, hf: false, tavily: false } }));
    expect(rec.profile).toBe("hybrid-1L-1S");
    expect(rec.localModel).toBe("ollama:qwen2.5-coder:3b");
  });

  it("recommends local-single with one local model and no keys", () => {
    expect(recommendProfile(R({ ollamaUp: true, ollamaModels: ["qwen2.5-coder:3b"] })).profile).toBe("local-single");
  });

  it("recommends local-varied with multiple local models and no keys", () => {
    expect(recommendProfile(R({ ollamaUp: true, ollamaModels: ["a:1", "b:2"] })).profile).toBe("local-varied");
  });

  it("recommends custom when only serverless keys are present", () => {
    expect(recommendProfile(R({ keys: { hf: true, anthropic: false, fireworks: false, tavily: false } })).profile).toBe("custom");
  });

  it("prefers a coder model locally", () => {
    expect(pickLocalCoder(["llama3.2:3b", "qwen2.5-coder:3b", "phi4-mini"])).toBe("qwen2.5-coder:3b");
  });

  it("flags local models a profile needs but that aren't installed", () => {
    const cfg = {
      profiles: { p: { tiers: { code: "ollama:qwen2.5-coder:3b", research: "ollama:llama3.2:3b" }, default: "fireworks:x" } },
    } as unknown as ChoraleConfig;
    expect(missingLocalModels(cfg, "p", ["qwen2.5-coder:3b"])).toEqual(["ollama:llama3.2:3b"]);
  });
});

describe("setActiveProfile (safe config edit)", () => {
  let dir: string;
  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("sets the commented activeProfile line and leaves the rest intact", () => {
    dir = mkdtempSync(join(tmpdir(), "chorale-init-"));
    const path = join(dir, "c.json5");
    writeFileSync(path, '{\n  // activeProfile: "local-single",\n  base: { model: "x" },\n}\n');
    setActiveProfile(path, "hybrid-1L-1S");
    const out = readFileSync(path, "utf8");
    expect(out).toContain('activeProfile: "hybrid-1L-1S",');
    expect(out).not.toContain("// activeProfile");
    expect(out).toContain('base: { model: "x" }');
  });
});

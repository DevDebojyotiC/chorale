import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recommendProfile, missingLocalModels, setActiveProfile, pickLocalCoder, recommendTieredProfile, writeGeneratedProfile } from "../src/core/init";
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

describe("Phase 2 — tiered init recommendation", () => {
  it("hybrid: heavy tiers → serverless, light tiers → local, smallest → utility", () => {
    const rec = recommendTieredProfile(
      R({ ollamaUp: true, ollamaModels: ["qwen2.5-coder:3b", "llama3.2:1b"], keys: { fireworks: true, anthropic: false, hf: false, tavily: false } }),
    );
    expect(rec.mode).toMatch(/hybrid/);
    expect(rec.profile.tiers?.code).toMatch(/^fireworks:/);
    expect(rec.profile.tiers?.chat).toMatch(/^ollama:/);
    expect(rec.profile.tiers?.utility).toBe("ollama:llama3.2:1b");
    expect(rec.profile.default).toBe("ollama:qwen2.5-coder:3b");
  });

  it("fully local when no keys: all tiers use installed models", () => {
    const rec = recommendTieredProfile(R({ ollamaUp: true, ollamaModels: ["qwen2.5-coder:3b"] }));
    expect(rec.mode).toBe("fully local");
    expect(rec.profile.tiers?.code).toBe("ollama:qwen2.5-coder:3b");
  });
});

describe("writeGeneratedProfile (marker region, re-runnable)", () => {
  it("inserts then replaces the generated region idempotently", () => {
    const d = mkdtempSync(join(tmpdir(), "chorale-gen-"));
    const path = join(d, "c.json5");
    writeFileSync(path, "{\n  profiles: {\n    custom: {},\n  },\n}\n");

    writeGeneratedProfile(path, "recommended", { default: "ollama:x", tiers: { code: "fireworks:y" } });
    let out = readFileSync(path, "utf8");
    expect(out).toContain('"recommended": {');
    expect(out).toContain('"ollama:x"');

    // re-run with different content → replaces, never duplicates
    writeGeneratedProfile(path, "recommended", { default: "ollama:z", tiers: { code: "hf:q" } });
    out = readFileSync(path, "utf8");
    expect((out.match(/chorale-init generated \(re-run/g) ?? []).length).toBe(1);
    expect(out).toContain('"ollama:z"');
    expect(out).not.toContain('"ollama:x"');
    expect(out).toContain("custom: {}"); // untouched
    rmSync(d, { recursive: true, force: true });
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

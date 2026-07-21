import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import JSON5 from "json5";
import { applyBaseChain, applyDefault } from "../src/core/config-edit";

// A realistic, heavily-commented config: the whole point is that these survive an edit.
const CONFIG = `{
  // Chorale configuration. Comments here are the reference docs — never lose them.
  activeProfile: "recommended",

  base: {
    // The default chain every agent inherits unless it overrides it.
    model: "ollama:qwen2.5-coder:3b",
    fallbacks: ["fireworks:gpt-oss-120b"],
  },

  providers: {
    // \${VAR} is resolved from .env at load time.
    fireworks: {
      api: "openai-compatible",
      baseUrl: "https://api.fireworks.ai/inference/v1",
      apiKey: "\${FIREWORKS_API_KEY}",
    },
  },

  profiles: {
    recommended: {
      // A profile has its OWN model key — the editor must not touch it.
      default: "ollama:qwen2.5-coder:3b",
      tiers: { code: "fireworks:gpt-oss-120b" },
    },
  },

  defaults: {
    maxSteps: 8, // how many tool steps per attempt
    maxRetries: 2,
  },
}`;

describe("config-edit — targeted edits that preserve comments", () => {
  it("sets base.model and base.fallbacks from a chain", () => {
    const out = applyBaseChain(CONFIG, ["fireworks:a", "zai:b", "ollama:c"]);
    expect(out).toMatch(/model:\s*"fireworks:a",/);
    expect(out).toMatch(/fallbacks:\s*\["zai:b", "ollama:c"\],/);
  });

  it("keeps every comment intact", () => {
    const out = applyBaseChain(CONFIG, ["fireworks:a"]);
    expect(out).toContain("// Chorale configuration. Comments here are the reference docs");
    expect(out).toContain("// The default chain every agent inherits");
    expect(out).toContain("// ${VAR} is resolved from .env at load time.");
    expect(out).toContain("// how many tool steps per attempt");
  });

  it("does NOT touch model keys in other blocks (profiles/providers)", () => {
    const out = applyBaseChain(CONFIG, ["fireworks:a"]);
    expect(out).toContain(`default: "ollama:qwen2.5-coder:3b"`); // profile untouched
    expect(out).toContain(`baseUrl: "https://api.fireworks.ai/inference/v1"`);
    expect(out).toContain(`apiKey: "\${FIREWORKS_API_KEY}"`);
  });

  it("a single-model chain clears the fallbacks", () => {
    const out = applyBaseChain(CONFIG, ["zai:only"]);
    expect(out).toMatch(/fallbacks:\s*\[\],/);
  });

  it("replaces a MULTI-LINE fallbacks array", () => {
    const multi = CONFIG.replace(`    fallbacks: ["fireworks:gpt-oss-120b"],`, `    fallbacks: [\n      "a:1",\n      "b:2",\n    ],`);
    const out = applyBaseChain(multi, ["p:1", "q:2"]);
    expect(out).toMatch(/fallbacks:\s*\["q:2"\],/);
    expect(out).not.toContain(`"a:1"`);
    expect(out).toContain("// The default chain every agent inherits"); // still intact
  });

  it("the result is still valid JSON5-ish (balanced braces)", () => {
    const out = applyBaseChain(CONFIG, ["x:1", "y:2"]);
    expect((out.match(/\{/g) ?? []).length).toBe((out.match(/\}/g) ?? []).length);
  });

  it("rejects an empty chain", () => {
    expect(() => applyBaseChain(CONFIG, [])).toThrow(/at least one model/i);
  });

  it("throws a clear error when there is no base block", () => {
    expect(() => applyBaseChain(`{ "providers": {} }`, ["a:b"])).toThrow(/base/);
  });

  it("applyDefault updates a scalar in defaults and keeps its comment", () => {
    const out = applyDefault(CONFIG, "maxSteps", 12);
    expect(out).toMatch(/maxSteps:\s*12,/);
    expect(out).toContain("// how many tool steps per attempt");
    expect(out).toMatch(/maxRetries:\s*2,/); // sibling untouched
  });

  it("applyDefault inserts a key that isn't present yet", () => {
    const out = applyDefault(CONFIG, "maxOutputTokens", 4096);
    expect(out).toMatch(/maxOutputTokens:\s*4096,/);
  });

  // The strongest guard: edit the REAL shipped config and make sure it still parses.
  it("keeps the real chorale.config.json5 valid after an edit", () => {
    const path = "config/chorale.config.json5";
    if (!existsSync(path)) return; // not present in some checkouts
    const src = readFileSync(path, "utf8");
    const out = applyBaseChain(src, ["fireworks:accounts/fireworks/models/gpt-oss-120b", "zai:glm-4.5-flash"]);
    const parsed = JSON5.parse(out) as { base: { model: string; fallbacks: string[] } };
    expect(parsed.base.model).toBe("fireworks:accounts/fireworks/models/gpt-oss-120b");
    expect(parsed.base.fallbacks).toEqual(["zai:glm-4.5-flash"]);
    // comments survive
    expect(out).toMatch(/\/\//);
    // and nothing else drifted: providers still parse
    expect(Object.keys((parsed as unknown as { providers: object }).providers).length).toBeGreaterThan(0);
  });
});

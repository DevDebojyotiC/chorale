// Phase 0 proof: exercises the full pipeline
//   agent.md → provider registry → runtime fallback chain → AI SDK → HTTP → streamed stdout
// against a mock OpenAI-compatible endpoint. Also proves the fallback chain by
// pointing the primary at a dead port and recovering onto the mock.
import { buildRegistry } from "../src/core/model-registry.js";
import { runAgent } from "../src/core/runtime.js";
import { loadAgent } from "../src/agents/loader.js";
import type { ChoraleConfig } from "../src/core/config.js";

const MOCK_PORT = Number(process.env.MOCK_PORT ?? 4599);

const config: ChoraleConfig = {
  base: { model: "mock:test-model", fallbacks: [] },
  providers: {
    mock: { api: "openai-compatible", baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, apiKey: "sk-mock" },
    dead: { api: "openai-compatible", baseUrl: "http://127.0.0.1:1/v1", apiKey: "x" },
  },
  agents: { dir: "agents", enabled: ["general"] },
  defaults: { maxSteps: 4 },
};

const registry = buildRegistry(config);
const agent = loadAgent("agents/general.md");

console.log("=== Scenario 1: happy path (base = mock:test-model) ===");
const r1 = await runAgent({ config, registry, agent, prompt: "Prove the pipeline works." });
console.log(`\n[proof] model used: ${r1.model}`);
console.log(`[proof] usage: ${JSON.stringify(r1.usage)}\n`);

console.log("=== Scenario 2: fallback (dead primary → mock fallback) ===");
const agentWithDeadPrimary = { ...agent, model: "dead:whatever", fallbacks: ["mock:test-model"] };
const r2 = await runAgent({ config, registry, agent: agentWithDeadPrimary, prompt: "Recover via fallback." });
console.log(`\n[proof] model used: ${r2.model} (expected mock:test-model after dead:whatever failed)\n`);

if (r1.model === "mock:test-model" && r2.model === "mock:test-model") {
  console.log("✅ PHASE 0 PROOF PASSED: model-agnostic pipeline + fallback chain both work.");
  process.exit(0);
} else {
  console.error("❌ PHASE 0 PROOF FAILED");
  process.exit(1);
}

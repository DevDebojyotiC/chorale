/**
 * Best-effort per-token rates for the `chorale cost` view. $/M tokens = [input, output].
 * Local (ollama:) models are free; unknown models return null (shown as "?").
 * Rates from the model-evaluation benchmarks — update as prices change.
 */
const RATES: Record<string, [number, number]> = {
  "hf:google/gemma-4-31B-it": [0, 0], // HF router — effectively free at our volumes
  "fireworks:accounts/fireworks/models/gpt-oss-120b": [0.15, 0.6],
  "fireworks:accounts/fireworks/models/gpt-oss-20b": [0.07, 0.3],
  "fireworks:accounts/fireworks/models/glm-5p2": [1.4, 4.4],
  "fireworks:accounts/fireworks/models/kimi-k2p6": [0.95, 4.0],
  "fireworks:accounts/fireworks/models/minimax-m2p7": [0.3, 1.2],
  "fireworks:accounts/fireworks/models/minimax-m3": [0.3, 1.2],
  "fireworks:accounts/fireworks/models/qwen3p7-plus": [0.4, 1.6],
  "fireworks:accounts/fireworks/models/deepseek-v4-pro": [1.74, 3.48],
  "fireworks:accounts/fireworks/models/deepseek-v4-flash": [0.14, 0.28],
  "fireworks:accounts/fireworks/models/nemotron-3-ultra-nvfp4": [0.6, 2.4],
};

/** Estimated USD for a token count, or null if the model's rate is unknown. */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number | null {
  if (model.startsWith("ollama:")) return 0; // local
  const r = RATES[model];
  if (!r) return null;
  return (inputTokens * r[0] + outputTokens * r[1]) / 1e6;
}

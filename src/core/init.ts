import { readFileSync, writeFileSync } from "node:fs";
import type { ChoraleConfig } from "./config.js";

export interface Resources {
  ollamaUp: boolean;
  ollamaModels: string[]; // e.g. ["qwen2.5-coder:3b", "phi4-mini:latest"]
  keys: { anthropic: boolean; fireworks: boolean; hf: boolean; tavily: boolean };
}

export interface Recommendation {
  profile: string;
  reason: string;
  localModel?: string;
}

/** Detect what's available: Ollama models (live) and which API keys are set. */
export async function detectResources(config: ChoraleConfig): Promise<Resources> {
  let ollamaUp = false;
  let ollamaModels: string[] = [];
  const ollama = config.providers.ollama;
  if (ollama?.baseUrl) {
    try {
      const base = ollama.baseUrl.replace(/\/v1\/?$/, "");
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const json = (await res.json()) as { models?: Array<{ name?: string }> };
        ollamaModels = (json.models ?? []).map((m) => m.name ?? "").filter(Boolean);
        ollamaUp = true;
      }
    } catch {
      /* Ollama not running / unreachable */
    }
  }
  return {
    ollamaUp,
    ollamaModels,
    keys: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      fireworks: Boolean(process.env.FIREWORKS_API_KEY),
      hf: Boolean(process.env.HF_TOKEN),
      tavily: Boolean(process.env.TAVILY_API_KEY),
    },
  };
}

/** Prefer a code-tuned local model, then a capable general one, then anything. */
export function pickLocalCoder(models: string[]): string | undefined {
  return (
    models.find((m) => /coder/i.test(m)) ??
    models.find((m) => /qwen2\.5|qwen3|llama3|gemma|phi/i.test(m)) ??
    models[0]
  );
}

/** Recommend a profile from detected resources. */
export function recommendProfile(r: Resources): Recommendation {
  const hasServerless = r.keys.fireworks || r.keys.hf || r.keys.anthropic;
  const hasLocal = r.ollamaUp && r.ollamaModels.length > 0;
  const localModel = hasLocal ? `ollama:${pickLocalCoder(r.ollamaModels)}` : undefined;

  if (hasLocal && hasServerless) {
    return {
      profile: r.keys.fireworks ? "hybrid-1L-1S" : "hybrid-1L-manyS",
      localModel,
      reason: "Local model for light/cheap turns + a serverless model for heavy coding & research.",
    };
  }
  if (hasLocal) {
    return {
      profile: r.ollamaModels.length > 1 ? "local-varied" : "local-single",
      localModel,
      reason: "Fully local. Single-model avoids VRAM reload latency; varied uses per-role models.",
    };
  }
  if (hasServerless) {
    return { profile: "custom", reason: "No local models detected — agents use their serverless models from agent.md." };
  }
  return { profile: "custom", reason: "No local models and no API keys — install an Ollama model or set a key in .env." };
}

/** All `ollama:` model refs referenced by a profile that aren't installed. */
export function missingLocalModels(config: ChoraleConfig, profileName: string, installed: string[]): string[] {
  const p = config.profiles?.[profileName];
  if (!p) return [];
  const refs = [p.default, ...Object.values(p.tiers ?? {}), ...Object.values(p.agents ?? {}), ...(p.fallbacks ?? [])]
    .filter((m): m is string => typeof m === "string" && m.startsWith("ollama:"));
  const have = new Set(installed.map((m) => `ollama:${m}`));
  return [...new Set(refs)].filter((m) => !have.has(m));
}

/** Safely set `activeProfile` in the config file, preserving the rest verbatim. */
export function setActiveProfile(configPath: string, name: string): void {
  let text = readFileSync(configPath, "utf8");
  const line = `  activeProfile: "${name}",`;
  if (/^[ \t]*\/\/[ \t]*activeProfile:.*$/m.test(text)) {
    text = text.replace(/^[ \t]*\/\/[ \t]*activeProfile:.*$/m, line);
  } else if (/^[ \t]*activeProfile:.*$/m.test(text)) {
    text = text.replace(/^[ \t]*activeProfile:.*$/m, line);
  } else {
    text = text.replace(/^\{[ \t]*\r?\n/, `{\n${line}\n`);
  }
  writeFileSync(configPath, text, "utf8");
}

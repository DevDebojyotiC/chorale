import { readFileSync, writeFileSync } from "node:fs";
import type { ChoraleConfig, Profile } from "./config.js";

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

/** Approximate parameter count (billions) from a model name, for "smallest" picks. */
function sizeOf(model: string): number {
  const m = model.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  return m ? parseFloat(m[1]!) : 99;
}
function firstMatch(models: string[], res: RegExp[]): string | undefined {
  for (const re of res) {
    const m = models.find((x) => re.test(x));
    if (m) return m;
  }
  return undefined;
}

export interface TieredRecommendation {
  profile: Profile;
  pulls: string[];
  mode: string;
}

/**
 * Build a tailored profile from the user's ACTUAL installed models (mapped to tiers)
 * plus serverless models for heavy tiers when keys exist. See docs/models-and-hardware.md.
 */
export function recommendTieredProfile(r: Resources): TieredRecommendation {
  const local = r.ollamaModels;
  const hasLocal = r.ollamaUp && local.length > 0;
  // Preference order for heavy tiers, best-value first. hf:gemma-4-31B is the
  // default: it beat Qwen2.5-7B 6/6 vs 3/6 on the coder ramp at ≈$0 and one-shots
  // (no repair thrash). glm-5p2 / Claude sit behind it as heavier escalation.
  const serverChain = [
    r.keys.hf ? "hf:google/gemma-4-31B-it" : undefined,
    r.keys.fireworks ? "fireworks:accounts/fireworks/models/glm-5p2" : undefined,
    r.keys.anthropic ? "anthropic:claude-sonnet-5" : undefined,
  ].filter((x): x is string => Boolean(x));
  const serverHeavy = serverChain[0];
  const hybrid = hasLocal && Boolean(serverHeavy);
  const ref = (m: string | undefined) => (m ? `ollama:${m}` : undefined);

  const coder = hasLocal ? ref(firstMatch(local, [/coder/i, /qwen2\.5|qwen3|llama3|gemma|phi|mistral/i]) ?? local[0]) : undefined;
  const general = hasLocal
    ? ref(local.find((m) => !/coder/i.test(m) && /qwen2\.5|qwen3|llama3|gemma|mistral|phi/i.test(m)) ?? firstMatch(local, [/coder/i]) ?? local[0])
    : undefined;
  const util = hasLocal ? ref([...local].sort((a, b) => sizeOf(a) - sizeOf(b))[0]) : undefined;
  const reasonLocal = hasLocal ? ref(local.find((m) => /r1|deepseek-r1|qwq|reason/i.test(m))) : undefined;

  const tiers: Record<string, string> = {};
  const put = (tier: string, val: string | undefined) => {
    if (val) tiers[tier] = val;
  };
  put("code", serverHeavy ?? coder);
  put("research", serverHeavy ?? coder);
  put("orchestrator", serverHeavy ?? coder ?? general);
  put("reason", serverHeavy ?? reasonLocal ?? coder);
  put("chat", general ?? coder);
  put("utility", util ?? general);

  const def = coder ?? general ?? serverHeavy ?? "ollama:qwen2.5-coder:3b";
  // Heavy chain escalates through the remaining server models, then falls back to local.
  const fallbacks = [...new Set([...serverChain.slice(1), coder ?? general].filter((x): x is string => Boolean(x)))];

  const pulls: string[] = [];
  if (hasLocal) {
    if (!local.some((m) => /coder/i.test(m))) pulls.push("qwen2.5-coder:3b   # code (recommended)");
    if (!local.some((m) => !/coder/i.test(m) && /qwen2\.5|llama3\.2:3|gemma/i.test(m))) pulls.push("qwen2.5:3b         # chat / general");
    if (!local.some((m) => sizeOf(m) <= 1.5)) pulls.push("llama3.2:1b        # utility (tiny/fast)");
  }

  return {
    profile: { description: "Generated by `chorale init` from installed models + keys.", default: def, tiers, fallbacks },
    pulls,
    mode: hybrid ? "hybrid (local light + serverless heavy)" : hasLocal ? "fully local" : "serverless",
  };
}

/** Serialize a profile to a JSON5 block (as it appears inside `profiles`). */
export function serializeProfile(name: string, p: Profile): string {
  const q = (s: string) => JSON.stringify(s);
  const lines: string[] = [`    ${q(name)}: {`];
  if (p.description) lines.push(`      description: ${q(p.description)},`);
  if (p.default) lines.push(`      default: ${q(p.default)},`);
  if (p.tiers && Object.keys(p.tiers).length) {
    lines.push(`      tiers: { ${Object.entries(p.tiers).map(([k, v]) => `${k}: ${q(v)}`).join(", ")} },`);
  }
  if (p.agents && Object.keys(p.agents).length) {
    lines.push(`      agents: { ${Object.entries(p.agents).map(([k, v]) => `${q(k)}: ${q(v)}`).join(", ")} },`);
  }
  if (p.fallbacks?.length) lines.push(`      fallbacks: [${p.fallbacks.map(q).join(", ")}],`);
  lines.push(`    },`);
  return lines.join("\n") + "\n";
}

const GEN_START = "    // >>> chorale-init generated (re-run to regenerate) >>>";
const GEN_END = "    // <<< chorale-init generated <<<";

/** Write (or replace) a generated profile inside the config's marked region — re-runnable. */
export function writeGeneratedProfile(configPath: string, name: string, profile: Profile): void {
  let text = readFileSync(configPath, "utf8");
  const region = `${GEN_START}\n${serializeProfile(name, profile)}${GEN_END}`;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marked = new RegExp(esc(GEN_START) + "[\\s\\S]*?" + esc(GEN_END));
  if (marked.test(text)) {
    text = text.replace(marked, region);
  } else if (/profiles:\s*\{\s*\r?\n/.test(text)) {
    text = text.replace(/(profiles:\s*\{\s*\r?\n)/, `$1${region}\n`);
  } else {
    text = text.replace(/^\{[ \t]*\r?\n/, `{\n  profiles: {\n${region}\n  },\n`);
  }
  writeFileSync(configPath, text, "utf8");
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

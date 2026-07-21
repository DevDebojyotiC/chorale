/**
 * What models can this provider actually serve? Asked live wherever possible — an OpenAI-compatible
 * `/models`, Ollama's tag list, or Anthropic's `/v1/models` — so the Settings dropdown offers models
 * the configured key can really reach, not a guess. Falls back to a small curated list (drawn from
 * refs this repo already ships) when the provider has no endpoint or the call fails.
 */

export interface ProviderModels {
  provider: string;
  models: string[];
  /** "live" = asked the provider; "catalog" = curated fallback (see `error` for why). */
  source: "live" | "catalog";
  error?: string;
}

/** Minimal provider shape (structural, to avoid importing the whole config schema). */
export interface ProviderLike {
  api: string;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

/** Curated fallbacks — only refs this project already uses, so we never invent model names. */
const CATALOG: Record<string, string[]> = {
  fireworks: [
    "accounts/fireworks/models/gpt-oss-120b",
    "accounts/fireworks/models/gpt-oss-20b",
    "accounts/fireworks/models/kimi-k2p6",
    "accounts/fireworks/models/deepseek-v4-pro",
  ],
  zai: ["glm-4.5-flash", "glm-4.7-flash", "glm-4.6", "glm-5.1"],
  puter: ["z-ai/glm-4.6", "z-ai/glm-4.5-flash"],
  hf: ["google/gemma-4-31B-it", "Qwen/Qwen2.5-7B-Instruct"],
  anthropic: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
  ollama: [],
};

async function fetchJson(url: string, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Pull model ids out of an OpenAI-style `{ data: [{ id }] }` payload. */
function idsFrom(payload: unknown): string[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((m) => (typeof m === "string" ? m : ((m as { id?: unknown })?.id as string | undefined)))
    .filter((s): s is string => typeof s === "string" && s.length > 0);
}

/** Ollama's native tag list: `{ models: [{ name }] }`. */
function ollamaNames(payload: unknown): string[] {
  const models = (payload as { models?: unknown })?.models;
  if (!Array.isArray(models)) return [];
  return models.map((m) => (m as { name?: unknown })?.name).filter((s): s is string => typeof s === "string");
}

const isLocal = (p: ProviderLike): boolean => /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(p.baseUrl ?? "");

/** List the models a provider can serve. Never throws — degrades to the curated catalog. */
export async function listProviderModels(name: string, p: ProviderLike, timeoutMs = 8000): Promise<ProviderModels> {
  const curated = () => [...(CATALOG[name] ?? [])].sort();
  try {
    if (p.api === "anthropic") {
      const j = await fetchJson("https://api.anthropic.com/v1/models", { "x-api-key": p.apiKey ?? "", "anthropic-version": "2023-06-01", ...p.headers }, timeoutMs);
      const models = idsFrom(j);
      return models.length ? { provider: name, models: models.sort(), source: "live" } : { provider: name, models: curated(), source: "catalog" };
    }

    if (p.api === "openai-compatible" && p.baseUrl) {
      const base = p.baseUrl.replace(/\/+$/, "");
      let models = idsFrom(await fetchJson(`${base}/models`, p.apiKey ? { Authorization: `Bearer ${p.apiKey}`, ...p.headers } : { ...p.headers }, timeoutMs));
      // Ollama also answers /v1/models, but fall back to its native tag list if that came back empty.
      if (models.length === 0 && isLocal(p)) {
        const root = base.replace(/\/v1$/, "");
        models = ollamaNames(await fetchJson(`${root}/api/tags`, {}, timeoutMs));
      }
      return models.length ? { provider: name, models: models.sort(), source: "live" } : { provider: name, models: curated(), source: "catalog" };
    }
  } catch (e) {
    return { provider: name, models: curated(), source: "catalog", error: e instanceof Error ? e.message : String(e) };
  }
  // No queryable endpoint (e.g. the Puter gateway) — curated list only.
  return { provider: name, models: curated(), source: "catalog" };
}

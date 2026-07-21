import { createProviderRegistry } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ChoraleConfig } from "./config.js";
import { puterFetch } from "./puter-provider.js";

/** A "<provider>:<model>" reference, e.g. "ollama:llama3.2". */
export type ModelRef = `${string}:${string}`;

/** A fetch wrapper that merges extra fields into the (JSON) request body. */
function extraBodyFetch(extra: Record<string, unknown>): typeof fetch {
  return async (input, init) => {
    if (init && typeof init.body === "string") {
      try {
        const body: unknown = JSON.parse(init.body);
        if (body && typeof body === "object") {
          init = { ...init, body: JSON.stringify({ ...(body as Record<string, unknown>), ...extra }) };
        }
      } catch {
        /* non-JSON body — leave untouched */
      }
    }
    return fetch(input, init);
  };
}

/**
 * Build a Vercel AI SDK provider registry from chorale config. Every provider is
 * pure config; adding one never requires code. Reference models as
 * `registry.languageModel("<provider>:<model>")`.
 */
export function buildRegistry(config: ChoraleConfig) {
  const providers: Record<string, ReturnType<typeof createAnthropic> | ReturnType<typeof createOpenAICompatible>> = {};

  for (const [name, p] of Object.entries(config.providers)) {
    if (p.api === "openai-compatible") {
      if (!p.baseUrl) {
        throw new Error(`Provider "${name}" is openai-compatible and needs a "baseUrl".`);
      }
      providers[name] = createOpenAICompatible({
        name,
        baseURL: p.baseUrl,
        apiKey: p.apiKey,
        headers: p.headers,
        ...(p.extraBody ? { fetch: extraBodyFetch(p.extraBody) } : {}),
      });
    } else if (p.api === "anthropic") {
      providers[name] = createAnthropic({ apiKey: p.apiKey, headers: p.headers });
    } else if (p.api === "puter") {
      // Reuse the openai-compatible model, but route every request through puter.ai.chat via a custom
      // fetch. The base URL is a placeholder the shim never actually hits; apiKey is the Puter token.
      providers[name] = createOpenAICompatible({
        name,
        baseURL: p.baseUrl ?? "https://api.puter.local/v1",
        apiKey: p.apiKey ?? "puter",
        headers: p.headers,
        fetch: puterFetch(p.apiKey),
      });
    }
  }

  if (Object.keys(providers).length === 0) {
    throw new Error("No providers configured. Add at least one under `providers` in chorale.config.json5.");
  }
  return createProviderRegistry(providers);
}

export type Registry = ReturnType<typeof buildRegistry>;

/**
 * Why the provider behind `ref` can't be used, or null if it looks usable. Checked BEFORE the request
 * so an unconfigured key fails with an actionable message instead of a bare 401 from the SDK — the
 * common first-run state of a packaged app, whose seeded .env ships with empty placeholders.
 */
export function providerUnusable(config: ChoraleConfig, ref: string): string | null {
  const name = ref.split(":")[0] ?? "";
  const p = config.providers[name];
  // Not in config: could be a custom/injected registry — let the registry decide, don't pre-empt it.
  if (!p) return null;
  // Local runtimes (Ollama/LM Studio/vLLM) need no key.
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(p.baseUrl ?? "")) return null;
  if (!p.apiKey || !p.apiKey.trim()) {
    return `no API key set for provider "${name}" — add it in Config (it's written to the workspace .env), then retry`;
  }
  return null;
}

/** Resolve the `${base}` sentinel to the configured base model. */
export function resolveRef(ref: string, config: ChoraleConfig): string {
  return ref === "${base}" ? config.base.model : ref;
}

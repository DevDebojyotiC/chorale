import { createProviderRegistry } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ChoraleConfig } from "./config.js";

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
    }
  }

  if (Object.keys(providers).length === 0) {
    throw new Error("No providers configured. Add at least one under `providers` in chorale.config.json5.");
  }
  return createProviderRegistry(providers);
}

export type Registry = ReturnType<typeof buildRegistry>;

/** Resolve the `${base}` sentinel to the configured base model. */
export function resolveRef(ref: string, config: ChoraleConfig): string {
  return ref === "${base}" ? config.base.model : ref;
}

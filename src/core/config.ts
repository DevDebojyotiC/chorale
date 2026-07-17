import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSON5 from "json5";
import { z } from "zod";

/** A single model provider. `openai-compatible` is the universal catch-all
 * (Ollama, LM Studio, vLLM, Fireworks, HF router, OpenRouter, Groq, DeepSeek…). */
const ProviderConfigSchema = z.object({
  api: z.enum(["openai-compatible", "anthropic"]),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  /** Extra fields merged into every request body — e.g. { think: false } to disable Ollama thinking. */
  extraBody: z.record(z.string(), z.unknown()).optional(),
});

/** A model profile: a named agent→model routing policy. See docs/model-profiles.md. */
const ProfileSchema = z.object({
  description: z.string().optional(),
  /** Catch-all model for any agent not otherwise mapped. */
  default: z.string().optional(),
  /** Map agent tier (role) → model. */
  tiers: z.record(z.string(), z.string()).optional(),
  /** Per-agent model override (highest within the profile). */
  agents: z.record(z.string(), z.string()).optional(),
  /** Profile-wide fallback chain, appended after agent + base fallbacks. */
  fallbacks: z.array(z.string()).optional(),
});

const ChoraleConfigSchema = z.object({
  base: z.object({
    model: z.string(),
    fallbacks: z.array(z.string()).default([]),
  }),
  /** Name of the active profile in `profiles` (unset = per-agent.md routing). */
  activeProfile: z.string().optional(),
  /** Named model-routing profiles. */
  profiles: z.record(z.string(), ProfileSchema).optional(),
  providers: z.record(z.string(), ProviderConfigSchema),
  agents: z.object({
    dir: z.string().default("agents"),
    enabled: z.array(z.string()).default([]),
  }),
  skills: z
    .object({ dirs: z.array(z.string()).default(["skills", ".claude/skills"]) })
    .default({ dirs: ["skills", ".claude/skills"] }),
  mcp: z
    .object({
      servers: z
        .record(
          z.string(),
          z.object({
            // stdio transport:
            command: z.string().optional(),
            args: z.array(z.string()).optional(),
            env: z.record(z.string(), z.string()).optional(),
            // http (streamable) transport:
            url: z.string().optional(),
            headers: z.record(z.string(), z.string()).optional(),
          }),
        )
        .default({}),
    })
    .default({ servers: {} }),
  permissions: z
    .object({ mode: z.enum(["read-only", "auto-edit", "full-auto"]).default("auto-edit") })
    .default({ mode: "auto-edit" }),
  defaults: z
    .object({
      maxSteps: z.number().int().positive().default(8),
      maxDelegationDepth: z.number().int().min(1).max(5).default(2),
      maxVerifyRounds: z.number().int().min(1).max(8).default(5),
      /** Per model-request timeout (ms). A hung provider aborts and falls back instead of hanging forever. */
      requestTimeoutMs: z.number().int().positive().default(180_000),
      /** Retries of the SAME model on fast transient errors (429 / 5xx / connection resets) before falling back. */
      maxRetries: z.number().int().min(0).max(5).default(2),
      /**
       * Max tokens the model may emit per step. Left unset, the provider's own (often small) default
       * applies and silently TRUNCATES long output mid-token — a large structured plan or a big file
       * write just stops, producing unparseable JSON with no error anywhere. Explicit and generous.
       */
      maxOutputTokens: z.number().int().positive().default(8192),
    })
    .default({ maxSteps: 8, maxDelegationDepth: 2, maxVerifyRounds: 5, requestTimeoutMs: 180_000, maxRetries: 2, maxOutputTokens: 8192 }),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type ChoraleConfig = z.infer<typeof ChoraleConfigSchema>;

const ENV_RE = /\$\{([A-Z0-9_]+)\}/g;

/** Replace `${ENV_VAR}` occurrences with values from the environment. */
function resolveEnv(value: string): string {
  return value.replace(ENV_RE, (_match, name: string) => process.env[name] ?? "");
}

/** Load, validate, and env-resolve the chorale config. */
export function loadConfig(path = "config/chorale.config.json5"): ChoraleConfig {
  const raw = readFileSync(resolve(path), "utf8");
  const parsed: unknown = JSON5.parse(raw);
  const config = ChoraleConfigSchema.parse(parsed);

  for (const provider of Object.values(config.providers)) {
    if (provider.apiKey) provider.apiKey = resolveEnv(provider.apiKey);
    if (provider.headers) {
      for (const key of Object.keys(provider.headers)) {
        provider.headers[key] = resolveEnv(provider.headers[key] ?? "");
      }
    }
  }
  for (const server of Object.values(config.mcp.servers)) {
    if (server.env) for (const k of Object.keys(server.env)) server.env[k] = resolveEnv(server.env[k] ?? "");
    if (server.headers) for (const k of Object.keys(server.headers)) server.headers[k] = resolveEnv(server.headers[k] ?? "");
  }
  return config;
}

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
});

const ChoraleConfigSchema = z.object({
  base: z.object({
    model: z.string(),
    fallbacks: z.array(z.string()).default([]),
  }),
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
  defaults: z
    .object({
      maxSteps: z.number().int().positive().default(8),
      maxDelegationDepth: z.number().int().min(1).max(5).default(2),
    })
    .default({ maxSteps: 8, maxDelegationDepth: 2 }),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
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

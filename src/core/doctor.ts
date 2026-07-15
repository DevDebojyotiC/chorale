import type { ChoraleConfig } from "./config.js";

export interface ProviderHealth {
  name: string;
  api: string;
  ok: boolean;
  detail: string;
  ms: number;
}

/** Resolve `${VAR}` references in a config value from the environment. */
function resolveEnv(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return v.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, k: string) => process.env[k] ?? "");
}

async function ping(url: string, headers: Record<string, string>): Promise<{ ok: boolean; detail: string; ms: number }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    return { ok: res.ok, detail: `HTTP ${res.status}`, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message.slice(0, 70) : String(e), ms: Date.now() - t0 };
  }
}

/** Ping every configured provider to confirm it's reachable (best-effort, 6s timeout each). */
export async function checkProviders(config: ChoraleConfig): Promise<ProviderHealth[]> {
  const out: ProviderHealth[] = [];
  for (const [name, cfg] of Object.entries(config.providers ?? {})) {
    const key = resolveEnv(cfg.apiKey);
    if (cfg.api === "anthropic") {
      if (!key) { out.push({ name, api: cfg.api, ok: false, detail: "no API key set", ms: 0 }); continue; }
      out.push({ name, api: cfg.api, ...(await ping("https://api.anthropic.com/v1/models", { "x-api-key": key, "anthropic-version": "2023-06-01" })) });
    } else {
      if (!cfg.baseUrl) { out.push({ name, api: cfg.api, ok: false, detail: "no baseUrl", ms: 0 }); continue; }
      const headers: Record<string, string> = {};
      if (key && key !== "ollama") headers.Authorization = `Bearer ${key}`;
      out.push({ name, api: cfg.api, ...(await ping(`${cfg.baseUrl.replace(/\/$/, "")}/models`, headers)) });
    }
  }
  return out;
}

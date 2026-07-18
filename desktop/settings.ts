/**
 * Settings write-back helpers (pure string transforms — unit-testable; main.ts applies them to the
 * workspace files). Step 3 covers provider API keys: a packaged user has no .env to hand-edit, so the
 * Settings UI writes keys to the workspace .env and the registry hot-reloads.
 */

/** The `${VAR}` env-var a provider's apiKey references, or null (local/sentinel providers need no key). */
export function envVarOf(rawApiKey: string | undefined): string | null {
  if (!rawApiKey) return null;
  const m = rawApiKey.match(/\$\{([A-Z0-9_]+)\}/);
  return m ? m[1]! : null;
}

/** Insert or replace `KEY=value` in a .env body, preserving the rest. Adds a trailing newline. */
export function upsertEnvVar(envText: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  if (re.test(envText)) return envText.replace(re, line);
  const base = envText.trim() ? envText.replace(/\s*$/, "\n") : "";
  return base + line + "\n";
}

/** Read the current value of `KEY` from a .env body (empty string if unset). */
export function readEnvVar(envText: string, key: string): string {
  const m = envText.match(new RegExp(`^\\s*${key}\\s*=(.*)$`, "m"));
  return m ? m[1]!.trim() : "";
}

/** A masked preview of a secret for display — first 3 + last 3, middle dotted; never the whole value. */
export function maskKey(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••";
  return value.slice(0, 3) + "…" + value.slice(-3);
}

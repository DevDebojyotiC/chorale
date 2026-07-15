/**
 * Scrub secrets from anything we log or persist. Conservative on purpose — it
 * removes exact secret values pulled from the environment plus a few unambiguous
 * token shapes, and avoids aggressive heuristics that could mangle real content.
 */

/** Secret values from the environment (vars that look like keys/tokens). */
function envSecretValues(): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (!v || v.length < 8) continue;
    if (/(_KEY|_TOKEN|_SECRET|PASSWORD|APIKEY|ACCESS_KEY)$/i.test(k)) out.push(v);
  }
  return out;
}

export function redactSecrets(s: string): string {
  if (!s) return s;
  let out = s;
  for (const secret of envSecretValues()) {
    if (out.includes(secret)) out = out.split(secret).join("***");
  }
  return out
    // Authorization: Bearer <token>
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]{12,}/gi, "$1***")
    // Provider key prefixes: sk-..., hf_..., fw_..., ghp_..., xai-..., etc.
    .replace(/\b((?:sk|pk|rk|hf|fw|xai|ghp|gho|glpat)[-_])[A-Za-z0-9]{16,}\b/gi, "$1***");
}

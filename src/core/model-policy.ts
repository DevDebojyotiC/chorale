import type { ChoraleConfig } from "./config.js";
import type { AgentSpec } from "../agents/loader.js";
import { resolveRef } from "./model-registry.js";

export interface ModelPlan {
  /** Resolved primary model, "<provider>:<model>". */
  model: string;
  /** Resolved fallback chain (deduped; excludes the primary). */
  fallbacks: string[];
}

/**
 * Resolve the model + fallback chain for an agent under the active profile.
 * Precedence for the primary model (see docs/model-profiles.md §3):
 *   --model  >  profile.agents[name]  >  profile.tiers[agent.tier]
 *            >  profile.default       >  agent.md model  >  base.model
 * Fallbacks = agent.fallbacks ++ profile.fallbacks ++ base.fallbacks ++ base.model.
 * With no active profile, this is identical to the pre-profiles behavior.
 */
export function resolveModelPlan(
  agent: AgentSpec,
  config: ChoraleConfig,
  cliModel?: string,
  profileName?: string,
): ModelPlan {
  const activeName = profileName ?? config.activeProfile;
  const profile = activeName ? config.profiles?.[activeName] : undefined;

  const primaryRaw =
    cliModel ??
    profile?.agents?.[agent.name] ??
    (agent.tier ? profile?.tiers?.[agent.tier] : undefined) ??
    profile?.default ??
    agent.model ??
    config.base.model;

  const model = resolveRef(primaryRaw, config);

  const chain = [
    ...agent.fallbacks,
    ...(profile?.fallbacks ?? []),
    ...config.base.fallbacks,
    config.base.model,
  ].map((ref) => resolveRef(ref, config));

  const fallbacks = [...new Set(chain)].filter((m) => m !== model);
  return { model, fallbacks };
}

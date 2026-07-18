import type { ChoraleBridge } from "../shared/ipc";

/** The API the preload injected on window.chorale. */
export const chorale: ChoraleBridge = (window as unknown as { chorale: ChoraleBridge }).chorale;

/**
 * Per-agent accent colors — the "orchestra sections" metaphor. Keyed by agent name; a stable hash
 * picks a color for any agent not in the map (so a user-authored agent.md still gets a consistent hue).
 */
const AGENT_COLORS: Record<string, string> = {
  orchestrator: "var(--a-orchestrator)",
  coder: "var(--a-coder)",
  planner: "var(--a-planner)",
  reviewer: "var(--a-reviewer)",
  scribe: "var(--a-scribe)",
  research: "var(--a-research)",
  "test-writer": "var(--a-test)",
  general: "var(--a-general)",
};
const PALETTE = ["var(--a-coder)", "var(--a-planner)", "var(--a-reviewer)", "var(--a-scribe)", "var(--a-research)", "var(--a-test)", "var(--a-general)", "var(--a-orchestrator)"];

export function agentColor(name: string): string {
  if (AGENT_COLORS[name]) return AGENT_COLORS[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** Map a RunEvent type → its semantic accent + short tag label. */
export function eventStyle(type: string): { color: string; tag: string } {
  switch (type) {
    case "fallback":
      return { color: "var(--crit)", tag: "fallback" };
    case "verify":
      return { color: "var(--a-reviewer)", tag: "verify" };
    case "heal":
      return { color: "var(--warn)", tag: "heal" };
    case "lesson":
      return { color: "var(--a-planner)", tag: "learn" };
    case "salvage":
      return { color: "var(--a-research)", tag: "salvage" };
    default:
      return { color: "var(--brand)", tag: type };
  }
}

/**
 * The Playbook (Phase 4 · escalate-last problem-solving).
 *
 * A persistent, self-growing knowledge base of {issue → verified fix}, plus a per-model capability
 * profile — the foundation for making escalation a LAST resort behind a recall→research→escalate
 * ladder. This module is the STORE + the (pure, deterministic) intelligence over it; wiring the
 * ladder into the runtime comes later.
 *
 * Two design ideas make it smart rather than a scoreboard:
 *   1. Intelligent trust — a fix's trust is only lowered by a FAIR failure (the escalated attempt
 *      failed with the fix in hand, or a model that has proven it can handle this class still
 *      failed). A weak model failing at thin context is a *capability* signal, not a fix-quality
 *      signal, so it doesn't penalize the fix.
 *   2. Capability profile — every application logs an episode (model, issue-class, context level,
 *      outcome); from it we learn at what context level a given model can solve a given class, and
 *      detect a capability gap (tried hard, never solved → route to a stronger model).
 *
 * Pure/deterministic (no model calls, timestamps injected) so all of the scoring is unit-testable.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";

/**
 * The launch directory, captured at module load — BEFORE any build-time `process.chdir()` into a
 * generated project's folder. The playbook is a global, cross-project knowledge base, so its default
 * path must resolve here (a stable location), not against the transient build cwd that would fragment
 * it per-project.
 */
const LAUNCH_CWD = process.cwd();

/** How much help the model had when it attempted the fix (cheap → expensive). */
export const CONTEXT_LEVELS = ["bare", "playbook", "research", "escalated"] as const;
export type ContextLevel = (typeof CONTEXT_LEVELS)[number];
export type Outcome = "worked" | "failed";

/** One attempt to solve an issue — the shared event both the trust score and the capability profile read. */
export interface SolveEvent {
  /** Issue-class fingerprint (what kind of problem this was). */
  signature: string;
  /** The playbook entry that was applied, if any. */
  entryId?: string;
  model: string;
  contextLevel: ContextLevel;
  outcome: Outcome;
  project?: string;
  step?: string;
  at: number;
}

export interface PlaybookEntry {
  id: string;
  /** Normalized fingerprint of the symptom — the retrieval key. */
  signature: string;
  keywords: string[];
  title: string;
  symptom: string;
  rootCause: string;
  /** The concrete fix that verifiably worked. */
  solution: string;
  /** Dead ends, so the model doesn't repeat them. */
  failedAttempts: string[];
  /** Tech/task context (e.g. "express + esm", "pdf render"). */
  context: string;
  source: "seeded" | "learned" | "researched";
  createdAt: number;
}

// ── fingerprinting + retrieval (deterministic) ────────────────────────────────

/** Normalize an error/symptom into stable tokens: drop paths, numbers, hashes, quotes. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[a-z]:\\[^\s'"]+|\/[^\s'"]+/g, " ") // file paths
    .replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{8,}\b/g, " ") // hashes/hex
    .replace(/\b\d+\b/g, " ") // numbers (ports, line numbers, counts)
    .replace(/[^a-z0-9_.-\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}
const STOP = new Set(["the", "and", "for", "was", "with", "not", "this", "that", "from", "does", "did", "you", "your", "are", "but", "its", "has", "have", "will", "can", "use", "using"]);

/** A stable signature string for an issue (the retrieval/class key). */
export function fingerprint(text: string): string {
  return tokens(text).slice(0, 40).join(" ");
}

/** Do two signatures describe the same class of issue? (shared distinctive tokens) */
export function classMatch(a: string, b: string): boolean {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return false;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap >= 2 || (overlap >= 1 && Math.min(ta.size, tb.size) <= 2);
}

/** Deterministic retrieval: entries whose signature/keywords overlap the query, best first. */
export function recall(entries: PlaybookEntry[], query: string, k = 3): PlaybookEntry[] {
  const q = new Set(tokens(query));
  if (q.size === 0) return [];
  return entries
    .map((e) => {
      const et = new Set([...tokens(e.signature), ...e.keywords.flatMap((x) => tokens(x))]);
      let overlap = 0;
      for (const t of q) if (et.has(t)) overlap++;
      return { e, overlap, score: overlap / Math.max(1, Math.min(q.size, et.size)) };
    })
    .filter((x) => x.overlap >= 2 || x.score >= 0.5)
    .sort((a, b) => b.score - a.score || b.overlap - a.overlap)
    .slice(0, k)
    .map((x) => x.e);
}

// ── capability profile (per model, per issue-class) ───────────────────────────

export interface CapabilityProfile {
  model: string;
  byLevel: Record<ContextLevel, { tried: number; worked: number }>;
  /** Solved this class at least once, at any level. */
  canHandle: boolean;
  /** The cheapest context level at which it succeeded (where the ladder should start). */
  minSuccessLevel: ContextLevel | null;
  /** Tried at a high level (research/escalated) and never solved → beyond this model. */
  gap: boolean;
}

export function capabilityProfile(events: SolveEvent[], model: string, signature: string): CapabilityProfile {
  const mine = events.filter((e) => e.model === model && classMatch(e.signature, signature));
  const byLevel = Object.fromEntries(CONTEXT_LEVELS.map((l) => [l, { tried: 0, worked: 0 }])) as CapabilityProfile["byLevel"];
  for (const e of mine) {
    byLevel[e.contextLevel].tried++;
    if (e.outcome === "worked") byLevel[e.contextLevel].worked++;
  }
  const canHandle = mine.some((e) => e.outcome === "worked");
  const minSuccessLevel = CONTEXT_LEVELS.find((l) => byLevel[l].worked > 0) ?? null;
  const triedHard = byLevel.research.tried + byLevel.escalated.tried > 0;
  return { model, byLevel, canHandle, minSuccessLevel, gap: !canHandle && triedHard };
}

// ── intelligent trust (per entry) ─────────────────────────────────────────────

export interface Trust {
  verdict: "trusted" | "unproven" | "suspect";
  /** 0..1 confidence the FIX itself is good. */
  score: number;
  validated: boolean;
  note: string;
}

export interface CapabilityLookup {
  /** Has `model` ever solved this issue-class (at any level)? */
  canHandle(model: string, signature: string): boolean;
}

/**
 * Trust the FIX, not the applier. A failure only counts against the fix if it was a *fair* test:
 * the escalated attempt failed with the fix in hand, or a model already proven capable of this
 * class failed. Weak-model-at-thin-context failures are attributed to capability, not the fix.
 */
export function trustOf(entry: PlaybookEntry, events: SolveEvent[], cap: CapabilityLookup): Trust {
  const apps = events.filter((e) => e.entryId === entry.id);
  const worked = apps.filter((a) => a.outcome === "worked");
  const validated = worked.length > 0;
  const fairFailures = apps.filter((a) => a.outcome === "failed" && (a.contextLevel === "escalated" || cap.canHandle(a.model, entry.signature)));
  const distinctSuccess = new Set(worked.map((w) => `${w.model}|${w.project ?? ""}`)).size;

  let verdict: Trust["verdict"];
  let note: string;
  if (validated) {
    verdict = "trusted";
    note = `worked ${worked.length}× (${distinctSuccess} independent)`;
  } else if (fairFailures.length > 0) {
    verdict = "suspect";
    note = `never worked despite ${fairFailures.length} capable attempt(s) — the fix itself may be wrong`;
  } else {
    verdict = "unproven";
    note = apps.length ? `${apps.length} application(s), none a fair test yet (capability-limited)` : "no applications yet";
  }
  // Laplace-smoothed: successes raise, only FAIR failures lower. Unfair failures are ignored.
  const s = distinctSuccess * 2;
  const score = Math.round(((s + 0.5) / (s + fairFailures.length + 1)) * 100) / 100;
  return { verdict, score, validated, note };
}

// ── the store (JSON persistence) ──────────────────────────────────────────────

interface PlaybookData {
  entries: PlaybookEntry[];
  events: SolveEvent[];
}

let seq = 0;

export class Playbook {
  private data: PlaybookData = { entries: [], events: [] };
  constructor(private readonly path: string) {
    try {
      if (existsSync(path)) this.data = JSON.parse(readFileSync(path, "utf8")) as PlaybookData;
    } catch {
      this.data = { entries: [], events: [] };
    }
    this.data.entries ??= [];
    this.data.events ??= [];
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.data, null, 2), "utf8");
    } catch {
      /* best-effort — a broken store must never crash a run */
    }
  }

  /** Retrieve fixes relevant to an issue, best (most-trusted, best-matched) first. */
  recall(query: string, k = 3): PlaybookEntry[] {
    const matched = recall(this.data.entries, query, k * 2);
    const cap = this.capabilityLookup();
    return matched
      .filter((e) => trustOf(e, this.data.events, cap).verdict !== "suspect") // don't recommend fixes known to be wrong
      .sort((a, b) => trustOf(b, this.data.events, cap).score - trustOf(a, this.data.events, cap).score)
      .slice(0, k);
  }

  /** Record a verified fix as a new entry (call only after the fix actually resolved the issue). */
  add(e: Omit<PlaybookEntry, "id" | "createdAt">, at: number): string {
    const id = `pb_${(at % 1e9).toString(36)}_${seq++}`;
    this.data.entries.push({ ...e, id, createdAt: at });
    this.persist();
    return id;
  }

  /** Log an attempt (feeds both the entry's trust and the model's capability profile). */
  logApplication(event: SolveEvent): void {
    this.data.events.push(event);
    this.persist();
  }

  trust(entryId: string): Trust | null {
    const e = this.data.entries.find((x) => x.id === entryId);
    return e ? trustOf(e, this.data.events, this.capabilityLookup()) : null;
  }

  capability(model: string, signature: string): CapabilityProfile {
    return capabilityProfile(this.data.events, model, signature);
  }

  /** Where the solve-ladder should start for this model+issue: a level, or escalate immediately. */
  recommendStart(model: string, signature: string): ContextLevel | "escalate" {
    const p = this.capability(model, signature);
    if (p.gap) return "escalate"; // model has tried hard on this class and never solved it
    return p.minSuccessLevel ?? "bare"; // start where it's known to succeed, else cheapest
  }

  private capabilityLookup(): CapabilityLookup {
    return { canHandle: (m, s) => capabilityProfile(this.data.events, m, s).canHandle };
  }

  entries(): readonly PlaybookEntry[] {
    return this.data.entries;
  }

  allEvents(): readonly SolveEvent[] {
    return this.data.events;
  }
}

let pbSingleton: Playbook | null = null;
/** Process-wide playbook (reused across a CLI turn incl. delegation), like the lesson store. */
export function getPlaybook(): Playbook {
  const p = process.env.CHORALE_PLAYBOOK_DB || "data/playbook.json";
  // Pin to the launch dir so a mid-run chdir into a build folder can't scatter per-project playbooks.
  return (pbSingleton ??= new Playbook(isAbsolute(p) ? p : resolve(LAUNCH_CWD, p)));
}
export function resetPlaybook(): void {
  pbSingleton = null;
}

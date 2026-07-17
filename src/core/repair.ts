/**
 * The repair ladder (Phase 4 · escalate-last problem-solving).
 *
 * When a gate flags a failure, don't jump to the bigger model. Climb a ladder, verifying after each
 * rung and only escalating when the cheaper rungs are exhausted:
 *
 *   playbook  → recall known verified fixes for this issue-class + a debugging method; cheap model retries
 *   research  → the known fixes didn't take; investigate deeper (read the failing files / research the
 *               library API), carrying forward what already failed
 *   escalate  → LAST resort: the stronger model, handed everything already tried so it doesn't restart
 *
 * Two capability-aware shortcuts (from the playbook's per-model profile):
 *   • start high — if this model has a proven *gap* on this class, skip straight to escalate
 *   • bail early — if a *trusted* fix was handed over and STILL didn't take, that's a capability gap,
 *     not a knowledge gap, so skip research and escalate
 *
 * Every attempt logs a SolveEvent (feeding trust + the capability profile); a win from research/escalate
 * is written back as a new playbook entry, so the junior inherits the senior's fix next time.
 */

import { getPlaybook, fingerprint, tokens, type Playbook, type ContextLevel, type PlaybookEntry } from "./playbook.js";
import { diagnose } from "./diagnose.js";

/** One rung's attempt: run the specialist with the given instruction; `escalate` swaps in the stronger model. */
export type RepairAttempt = (input: { instruction: string; escalate: boolean; level: ContextLevel }) => Promise<{ text: string }>;
/** Re-run the gate; return the remaining issue messages (empty ⇒ solved). */
export type RepairCheck = () => Promise<string[]> | string[];

export interface LadderDeps {
  attempt: RepairAttempt;
  recheck: RepairCheck;
  /** The cheap model's id — how the capability profile is keyed. */
  model: string;
  /** Short tag for the gate (e.g. "runnability", "boot") — used in learned-entry titles. */
  kind: string;
  hasResearch: boolean;
  canEscalate: boolean;
  /** The stronger model used for the escalate rung — so its attempt is scored under ITS name, not the cheap model's. */
  escalateModel?: string;
  /** Optional: delegate the middle rung to a research agent, returning findings to hand the coder. */
  research?: (input: { issues: string[]; errorText: string }) => Promise<string>;
  /** Optional: a hash of the project's files, so a rung that writes NOTHING (the model explained instead
   *  of writing) is detected as a no-op and force-retried before the ladder advances. */
  fingerprint?: () => string;
  playbook?: Playbook;
  project?: string;
  step?: string;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface LadderResult {
  solved: boolean;
  rungs: { level: ContextLevel; solved: boolean }[];
  startedAt: ContextLevel;
  remaining: string[];
}

const LADDER: ContextLevel[] = ["playbook", "research", "escalated"];

const DEBUG_METHOD =
  "Debug methodically: (1) reproduce — find the exact failing file/line named in the error; (2) localize — read that file and the ones it imports; (3) hypothesize ONE root cause; (4) apply the smallest fix that addresses that cause; (5) confirm you didn't break the entry point. Write the corrected file(s) in full with the write tool (it creates folders — do not use mkdir/bash).";

const RESEARCH_METHOD =
  "The known fixes did not resolve this. Investigate deeper before editing: re-read the failing file(s), and if this involves a library or framework API, work out its correct usage from first principles. Then apply a fix grounded in what you found — not another guess.";

const ESCALATE_METHOD =
  "This is the final attempt, with a stronger model. Everything already tried is listed below — do NOT restart from scratch. Build on it and fix the remaining problem decisively.";

const FORCE_WRITE =
  "IMPORTANT: your previous attempt wrote NO files — you only described the change. This time you MUST call the write tool and output the COMPLETE contents of each file you need to create or replace. If a target file already exists as a stub/placeholder, REPLACE its entire contents. Do not explain, summarize, or defer to a later step — write the file(s) now.";

const firstLine = (s: string): string => (s.split("\n").find((l) => l.trim()) ?? s).trim().slice(0, 140);

function formatEntry(e: PlaybookEntry): string {
  const avoid = e.failedAttempts.length ? ` Avoid: ${e.failedAttempts.join("; ")}.` : "";
  return `• A verified fix for a similar issue ("${e.title}"): ${e.solution} (Root cause: ${e.rootCause}.)${avoid}`;
}

function playbookAugment(hits: PlaybookEntry[], errorText: string): string {
  const known = hits.length ? "Fixes that worked on similar issues before — try the most relevant first:\n" + hits.map(formatEntry).join("\n") + "\n\n" : "";
  const hints = diagnose([errorText]).trim();
  return known + hints + (known || hints ? "\n\n" : "") + DEBUG_METHOD;
}

function carry(findings: string[]): string {
  return findings.length ? "\n\nAlready attempted (do not repeat these):\n" + findings.map((f) => `- ${f}`).join("\n") : "";
}

function buildInstruction(issues: string[], augment: string): string {
  return (
    "The build has problems that must be fixed. Fix each one (write the corrected files in full):\n" +
    issues.map((i) => `- ${i}`).join("\n") +
    "\n\n" +
    augment
  );
}

/** Climb the repair ladder for a set of gate issues. Returns whether the gate is now clean. */
export async function runRepairLadder(initialIssues: string[], deps: LadderDeps): Promise<LadderResult> {
  const pb = deps.playbook ?? getPlaybook();
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  const errorText = initialIssues.join("\n");
  const signature = fingerprint(errorText);

  // Capability-aware start. A freshly-recalled fix is new information, so it always earns the cheap
  // playbook rung — even if this model historically needed a higher rung for this class (the playbook
  // has since grown). Only when there is nothing new to inject do we let the capability profile skip
  // ahead: to escalate on a proven gap, or past the method-only playbook rung it never solves at.
  const haveFix = pb.recall(errorText, 1).length > 0;
  const recommended = pb.recommendStart(deps.model, signature);
  let idx = haveFix
    ? 0
    : recommended === "escalate" || recommended === "escalated"
      ? LADDER.indexOf("escalated")
      : recommended === "research"
        ? LADDER.indexOf("research")
        : 0;
  if (idx > 0) log(`capability profile → starting at the "${LADDER[idx]}" rung (cheaper rungs skipped)`);
  const startedAt = LADDER[Math.min(idx, LADDER.length - 1)]!;

  const rungs: LadderResult["rungs"] = [];
  const findings: string[] = [];
  let current = initialIssues;

  for (; idx < LADDER.length; idx++) {
    const level = LADDER[idx]!;
    if (level === "research" && !deps.hasResearch) continue; // no researcher available → straight to escalate
    if (level === "escalated" && !deps.canEscalate) break; // escalation disabled → stop here

    let augment: string;
    let appliedEntry: PlaybookEntry | undefined;
    let appliedTrusted = false;
    if (level === "playbook") {
      const hits = pb.recall(errorText, 3);
      appliedEntry = hits[0];
      appliedTrusted = hits.some((h) => pb.trust(h.id)?.verdict === "trusted");
      augment = playbookAugment(hits, errorText);
      if (hits.length) log(`playbook rung: injected ${hits.length} known fix(es)`);
      else log("playbook rung: no known fix yet — debugging from method");
    } else if (level === "research") {
      let notes = "";
      if (deps.research) {
        log("research rung: delegating to the research agent");
        try {
          notes = (await deps.research({ issues: current, errorText })).trim();
        } catch (e) {
          log(`research rung: research delegate failed (${e instanceof Error ? e.message : String(e)}) — coder investigates instead`);
        }
      } else {
        log("research rung: no research agent — coder investigates");
      }
      augment = RESEARCH_METHOD + (notes ? "\n\nResearch findings to apply:\n" + notes : "") + carry(findings);
    } else {
      augment = ESCALATE_METHOD + carry(findings);
      log("escalate rung: handing the stronger model everything tried so far");
    }

    const runAttempt = async (instruction: string): Promise<string> => {
      try {
        return (await deps.attempt({ instruction, escalate: level === "escalated", level })).text;
      } catch (e) {
        return `[attempt errored: ${e instanceof Error ? e.message : String(e)}]`;
      }
    };
    const before = deps.fingerprint?.();
    let text = await runAttempt(buildInstruction(current, augment));
    let remaining = await deps.recheck();
    // No-op guard: if the project is byte-for-byte unchanged and the issue persists, the model
    // "explained" instead of writing (the exact InventoryIQ failure). Force one write-only retry.
    if (remaining.length > 0 && before !== undefined && deps.fingerprint?.() === before) {
      log(`${level} rung wrote no files — forcing a write-only retry`);
      text = await runAttempt(FORCE_WRITE + "\n\n" + buildInstruction(current, augment));
      remaining = await deps.recheck();
    }
    const solved = remaining.length === 0;

    // Score each attempt under the model that ACTUALLY ran it: the escalate rung is a different
    // (stronger) model, so its success/failure must not be attributed to the cheap model — otherwise
    // the capability profile falsely credits the cheap model and never records the strong one.
    const attemptModel = level === "escalated" ? (deps.escalateModel ?? deps.model) : deps.model;
    pb.logApplication({ signature, entryId: level === "playbook" ? appliedEntry?.id : undefined, model: attemptModel, contextLevel: level, outcome: solved ? "worked" : "failed", project: deps.project, step: deps.step, at: now() });
    rungs.push({ level, solved });
    findings.push(`[${level}] ${solved ? "resolved the issue" : `still failing: ${remaining.slice(0, 2).join("; ").slice(0, 180)}`}`);

    if (solved) {
      // Write-back: a win beyond the existing playbook becomes a new entry, so the cheap model inherits it.
      if (level !== "playbook") {
        pb.add(
          {
            signature,
            keywords: [...new Set(tokens(errorText))].slice(0, 8),
            title: `${deps.kind}: ${firstLine(errorText)}`,
            symptom: firstLine(errorText),
            rootCause: "learned from a successful repair",
            solution: text.replace(/\s+/g, " ").trim().slice(0, 500) || "(applied a corrected version of the failing file)",
            failedAttempts: findings.filter((f) => f.includes("still failing")).map((f) => f.replace(/^\[\w+\]\s*/, "")),
            context: deps.kind,
            source: level === "research" ? "researched" : "learned",
          },
          now(),
        );
        log(`learned: recorded this ${level} fix to the playbook`);
      }
      return { solved: true, rungs, startedAt, remaining: [] };
    }

    current = remaining.length ? remaining : current;

    // Capability-gap shortcut: a *trusted* fix was handed over and still didn't take → this model can't
    // apply it (capability, not knowledge). Skip research; escalate.
    if (level === "playbook" && appliedTrusted && deps.canEscalate) {
      log("a trusted fix didn't take → capability gap, escalating");
      idx = LADDER.indexOf("escalated") - 1; // the loop's ++ lands on "escalated"
    }
  }

  return { solved: false, rungs, startedAt, remaining: current };
}

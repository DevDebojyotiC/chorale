import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRepairLadder, type LadderDeps } from "../src/core/repair";
import { Playbook, fingerprint } from "../src/core/playbook";

const tmpPb = (): Playbook => new Playbook(join(mkdtempSync(join(tmpdir(), "pb-")), "playbook.json"));

/** A fake gate: `failsUntilLevel` is the rung at which the coder "fixes" it. */
function harness(playbook: Playbook, failsUntilLevel: string | null, opts: Partial<LadderDeps> = {}) {
  const attempts: { level: string; escalate: boolean; instruction: string }[] = [];
  let broken = true;
  const deps: LadderDeps = {
    playbook,
    model: "gemma-cheap",
    kind: "runnability",
    hasResearch: true,
    canEscalate: true,
    now: () => 1000 + attempts.length,
    attempt: async ({ instruction, escalate, level }) => {
      attempts.push({ level, escalate, instruction });
      if (failsUntilLevel !== null && level === failsUntilLevel) broken = false;
      return { text: `attempted at ${level}` };
    },
    recheck: () => (broken ? ["server has no entry point that calls listen()"] : []),
    ...opts,
  };
  return { deps, attempts, issues: ["server has no entry point that calls listen()"] };
}

describe("repair ladder — rungs & escalation order", () => {
  it("solves at the playbook rung without escalating", async () => {
    const pb = tmpPb();
    const { deps, attempts, issues } = harness(pb, "playbook");
    const r = await runRepairLadder(issues, deps);
    expect(r.solved).toBe(true);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.level).toBe("playbook");
    expect(attempts.some((a) => a.escalate)).toBe(false); // never reached the stronger model
  });

  it("climbs playbook → research → escalate in order, escalating LAST", async () => {
    const pb = tmpPb();
    const { deps, attempts, issues } = harness(pb, "escalated");
    const r = await runRepairLadder(issues, deps);
    expect(r.solved).toBe(true);
    expect(attempts.map((a) => a.level)).toEqual(["playbook", "research", "escalated"]);
    expect(attempts.at(-1)!.escalate).toBe(true); // only the final rung used the strong model
    expect(attempts[1]!.instruction).toMatch(/already attempted/i); // research carries prior findings forward
  });

  it("skips the research rung when no researcher is available", async () => {
    const pb = tmpPb();
    const { deps, attempts, issues } = harness(pb, "escalated", { hasResearch: false });
    await runRepairLadder(issues, deps);
    expect(attempts.map((a) => a.level)).toEqual(["playbook", "escalated"]);
  });

  it("stops after the cheap rungs when escalation is disabled", async () => {
    const pb = tmpPb();
    const { deps, attempts, issues } = harness(pb, null, { canEscalate: false });
    const r = await runRepairLadder(issues, deps);
    expect(r.solved).toBe(false);
    expect(attempts.map((a) => a.level)).toEqual(["playbook", "research"]); // never escalated
  });
});

describe("repair ladder — write-back (learning)", () => {
  it("records a research/escalate win as a new playbook entry, but not a plain playbook win", async () => {
    const pb = tmpPb();
    const before = pb.entries().length;
    const { deps, issues } = harness(pb, "research");
    await runRepairLadder(issues, deps);
    const added = pb.entries().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.source).toBe("researched");
    expect(added[0]!.solution).toMatch(/attempted at research/);

    // Next time, the same issue is now recallable and solvable at the playbook rung.
    const h2 = harness(pb, "playbook");
    const r2 = await runRepairLadder(h2.issues, h2.deps);
    expect(r2.solved).toBe(true);
    expect(h2.attempts.map((a) => a.level)).toEqual(["playbook"]);
    expect(pb.entries()).toHaveLength(before + 1); // a playbook win adds nothing new
  });
});

describe("repair ladder — no-op write guard", () => {
  it("force-retries a rung that wrote NOTHING (model explained instead of writing)", async () => {
    const pb = tmpPb();
    let disk = "broken"; // the project's content fingerprint
    let broken = true;
    const attempts: { instruction: string }[] = [];
    const deps: LadderDeps = {
      playbook: pb,
      model: "gemma-cheap",
      kind: "runnability",
      hasResearch: false,
      canEscalate: false,
      now: () => 1,
      fingerprint: () => disk,
      attempt: async ({ instruction }) => {
        attempts.push({ instruction });
        // First try: explain only — write nothing (disk unchanged). Forced retry: actually write.
        if (/write.*NO files|write the file/i.test(instruction) || instruction.includes("previous attempt wrote NO files")) {
          disk = "fixed";
          broken = false;
        }
        return { text: "attempted" };
      },
      recheck: () => (broken ? ["server has no entry point that calls listen()"] : []),
    };
    const r = await runRepairLadder(["server has no entry point that calls listen()"], deps);
    expect(r.solved).toBe(true);
    expect(attempts).toHaveLength(2); // first no-op, then the forced write-only retry
    expect(attempts[1]!.instruction).toMatch(/wrote NO files/i);
  });

  it("does NOT force-retry when the attempt changed files (even if still failing)", async () => {
    const pb = tmpPb();
    let disk = 0;
    const attempts: string[] = [];
    const deps: LadderDeps = {
      playbook: pb,
      model: "gemma-cheap",
      kind: "runnability",
      hasResearch: false,
      canEscalate: false,
      now: () => 1,
      fingerprint: () => String(disk),
      attempt: async ({ instruction }) => {
        attempts.push(instruction);
        disk++; // it DID write something (fingerprint changes) — just didn't fix it
        return { text: "attempted" };
      },
      recheck: () => ["still failing"],
    };
    await runRepairLadder(["still failing"], deps);
    expect(attempts).toHaveLength(1); // only the playbook rung; no forced retry (files changed)
  });
});

describe("repair ladder — research delegation", () => {
  it("delegates the middle rung to the research agent and feeds findings to the coder", async () => {
    const pb = tmpPb();
    let researched = false;
    const { deps, attempts, issues } = harness(pb, "research", {
      research: async ({ issues }) => {
        researched = true;
        expect(issues.length).toBeGreaterThan(0);
        return "Use export default instead of module.exports in the route file.";
      },
    });
    const r = await runRepairLadder(issues, deps);
    expect(researched).toBe(true);
    expect(r.solved).toBe(true);
    const researchAttempt = attempts.find((a) => a.level === "research")!;
    expect(researchAttempt.instruction).toMatch(/research findings to apply/i);
    expect(researchAttempt.instruction).toMatch(/export default/);
  });

  it("falls back to coder-investigates when the research delegate throws", async () => {
    const pb = tmpPb();
    const { deps, attempts, issues } = harness(pb, "research", {
      research: async () => {
        throw new Error("tavily down");
      },
    });
    const r = await runRepairLadder(issues, deps);
    expect(r.solved).toBe(true); // the coder still gets the research rung, just without findings
    expect(attempts.find((a) => a.level === "research")!.instruction).not.toMatch(/research findings to apply/i);
  });
});

describe("repair ladder — capability attribution across models", () => {
  it("scores the escalated attempt under the ESCALATE model, giving each model its own profile", async () => {
    const pb = tmpPb();
    const { deps, issues } = harness(pb, "escalated", { escalateModel: "strong-gpt" });
    await runRepairLadder(issues, deps);
    const sig = fingerprint(issues.join("\n"));

    // The cheap model tried playbook + research and never solved → a real capability GAP for it...
    const cheap = pb.capability("gemma-cheap", sig);
    expect(cheap.canHandle).toBe(false);
    expect(cheap.gap).toBe(true);
    expect(cheap.byLevel.escalated.tried).toBe(0); // the escalated win is NOT falsely credited to it

    // ...and the strong model is recorded as the one that actually solved it at the escalated rung.
    const strong = pb.capability("strong-gpt", sig);
    expect(strong.canHandle).toBe(true);
    expect(strong.byLevel.escalated.worked).toBe(1);

    // So next time, with no fresh fix to inject, the cheap model routes straight to escalate.
    expect(pb.recommendStart("gemma-cheap", sig)).toBe("escalate");
  });
});

describe("repair ladder — capability-aware shortcuts", () => {
  it("starts at escalate when the model has a proven gap on this class", async () => {
    const pb = tmpPb();
    const sig = fingerprint("server has no entry point that calls listen()");
    // Prior history: this model tried hard (research) and never solved this class.
    pb.logApplication({ signature: sig, model: "gemma-cheap", contextLevel: "research", outcome: "failed", at: 1 });
    const { deps, attempts, issues } = harness(pb, "escalated");
    const r = await runRepairLadder(issues, deps);
    expect(r.startedAt).toBe("escalated");
    expect(attempts.map((a) => a.level)).toEqual(["escalated"]); // cheap rungs skipped
    expect(r.solved).toBe(true);
  });

  it("bails to escalate when a TRUSTED fix was handed over and still didn't take", async () => {
    const pb = tmpPb();
    const sig = fingerprint("server has no entry point that calls listen()");
    // Seed a trusted entry (worked before) for this class...
    const id = pb.add(
      { signature: sig, keywords: ["server", "entry", "listen"], title: "no entry", symptom: "no listen()", rootCause: "missing entry", solution: "add a server.js that calls app.listen(process.env.PORT)", failedAttempts: [], context: "express", source: "learned" },
      1,
    );
    pb.logApplication({ signature: sig, entryId: id, model: "someone", contextLevel: "playbook", outcome: "worked", at: 2 });
    expect(pb.trust(id)!.verdict).toBe("trusted");

    // ...but our cheap model can't apply it — only the escalated rung fixes it. Research must be SKIPPED.
    const { deps, attempts, issues } = harness(pb, "escalated");
    const r = await runRepairLadder(issues, deps);
    expect(r.solved).toBe(true);
    expect(attempts.map((a) => a.level)).toEqual(["playbook", "escalated"]); // research skipped (capability gap)
  });
});

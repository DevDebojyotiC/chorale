import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fingerprint,
  tokens,
  classMatch,
  recall,
  trustOf,
  capabilityProfile,
  Playbook,
  type PlaybookEntry,
  type SolveEvent,
  type CapabilityLookup,
} from "../src/core/playbook";

const tmp = (): string => join(mkdtempSync(join(tmpdir(), "pb-")), "playbook.json");

const entry = (over: Partial<PlaybookEntry> = {}): PlaybookEntry => ({
  id: "e1",
  signature: fingerprint("Error: Cannot use import statement outside a module"),
  keywords: ["esm", "commonjs", "module.exports"],
  title: "CJS in an ESM project",
  symptom: "route file used module.exports in a type:module project",
  rootCause: "mixing CommonJS and ESM",
  solution: "convert module.exports to export default",
  failedAttempts: ["adding .cjs extension without updating imports"],
  context: "express + esm",
  source: "learned",
  createdAt: 1,
  ...over,
});

const noCap: CapabilityLookup = { canHandle: () => false };

describe("Playbook — fingerprinting & deterministic retrieval", () => {
  it("normalizes away paths, numbers, and hashes so the same class matches", () => {
    const a = fingerprint("D:\\proj\\server.js:42 Error EADDRINUSE port 3000");
    const b = fingerprint("/home/x/server.js:9 Error EADDRINUSE port 8080");
    expect(a).toBe(b);
    expect(tokens("port 3000 abcdef123456")).not.toContain("3000");
  });

  it("recall returns entries whose signature/keywords overlap the query", () => {
    const entries = [
      entry(),
      entry({ id: "e2", signature: fingerprint("ERR_FILE_NOT_FOUND chrome pdf render"), keywords: ["pdf", "chrome", "file url"], title: "bad file:// url" }),
    ];
    const hits = recall(entries, "Cannot use import statement outside a module in route", 3);
    expect(hits[0]?.id).toBe("e1");
    expect(recall(entries, "chrome could not render the pdf file url", 3)[0]?.id).toBe("e2");
  });

  it("recall returns nothing for an unrelated query (no false matches)", () => {
    expect(recall([entry()], "tailwind css class not applied in build", 3)).toEqual([]);
  });

  it("classMatch groups the same issue-class across superficial differences", () => {
    expect(classMatch("Error Cannot use import statement outside module", "cannot use import statement outside a module here")).toBe(true);
    expect(classMatch("EADDRINUSE port in use", "tailwind purge removed my classes")).toBe(false);
  });
});

describe("Playbook — intelligent trust (pointer 1)", () => {
  it("does NOT penalize a good fix for weak-model-at-thin-context failures", () => {
    // Found 3×, solved 1×. The 2 misses were the same weak model at bare context → capability, not the fix.
    const e = entry();
    const events: SolveEvent[] = [
      { signature: e.signature, entryId: e.id, model: "weak", contextLevel: "bare", outcome: "failed", at: 1 },
      { signature: e.signature, entryId: e.id, model: "weak", contextLevel: "bare", outcome: "failed", at: 2 },
      { signature: e.signature, entryId: e.id, model: "weak", contextLevel: "playbook", outcome: "worked", at: 3 },
    ];
    const t = trustOf(e, events, noCap);
    expect(t.verdict).toBe("trusted");
    expect(t.validated).toBe(true);
    expect(t.score).toBeGreaterThan(0.6); // the two bare misses didn't drag it down
  });

  it("marks a fix SUSPECT only when a FAIR test fails (escalated, with the fix in hand)", () => {
    const e = entry();
    const events: SolveEvent[] = [
      { signature: e.signature, entryId: e.id, model: "strong", contextLevel: "escalated", outcome: "failed", at: 1 },
    ];
    expect(trustOf(e, events, noCap).verdict).toBe("suspect");
  });

  it("counts a failure as fair when a PROVEN-capable model still fails with the fix", () => {
    const e = entry();
    const capable: CapabilityLookup = { canHandle: () => true }; // this model has solved the class before
    const events: SolveEvent[] = [{ signature: e.signature, entryId: e.id, model: "m", contextLevel: "playbook", outcome: "failed", at: 1 }];
    expect(trustOf(e, events, capable).verdict).toBe("suspect");
  });

  it("is 'unproven', not 'suspect', when the only failures are capability-limited", () => {
    const e = entry();
    const events: SolveEvent[] = [{ signature: e.signature, entryId: e.id, model: "weak", contextLevel: "bare", outcome: "failed", at: 1 }];
    expect(trustOf(e, events, noCap).verdict).toBe("unproven");
  });
});

describe("Playbook — capability profile & gap detection (pointer 2)", () => {
  it("learns the level at which a model becomes capable of a class", () => {
    const sig = fingerprint("Cannot use import statement outside a module");
    const events: SolveEvent[] = [
      { signature: sig, model: "gemma", contextLevel: "bare", outcome: "failed", project: "p1", step: "s2", at: 1 },
      { signature: sig, model: "gemma", contextLevel: "playbook", outcome: "worked", project: "p1", step: "s2", at: 2 },
    ];
    const p = capabilityProfile(events, "gemma", sig);
    expect(p.canHandle).toBe(true);
    expect(p.minSuccessLevel).toBe("playbook"); // needs the playbook; bare wasn't enough
    expect(p.gap).toBe(false);
    expect(p.byLevel.bare).toEqual({ tried: 1, worked: 0 });
  });

  it("detects a capability GAP: tried hard (research/escalated) and never solved", () => {
    const sig = fingerprint("webpack module federation shared singleton mismatch");
    const events: SolveEvent[] = [
      { signature: sig, model: "gemma", contextLevel: "playbook", outcome: "failed", at: 1 },
      { signature: sig, model: "gemma", contextLevel: "research", outcome: "failed", at: 2 },
    ];
    const p = capabilityProfile(events, "gemma", sig);
    expect(p.canHandle).toBe(false);
    expect(p.gap).toBe(true);
  });

  it("scopes the profile to the model and the issue-class", () => {
    const sig = fingerprint("EADDRINUSE address already in use");
    const events: SolveEvent[] = [
      { signature: sig, model: "gemma", contextLevel: "bare", outcome: "worked", at: 1 },
      { signature: fingerprint("tailwind classes purged"), model: "gemma", contextLevel: "bare", outcome: "worked", at: 2 },
      { signature: sig, model: "other", contextLevel: "bare", outcome: "worked", at: 3 },
    ];
    expect(capabilityProfile(events, "gemma", sig).byLevel.bare.tried).toBe(1);
  });
});

describe("Playbook — store: persistence, recall filtering, routing", () => {
  it("persists entries and events across reopen", () => {
    const path = tmp();
    const pb = new Playbook(path);
    const id = pb.add(entry(), 1000);
    pb.logApplication({ signature: entry().signature, entryId: id, model: "m", contextLevel: "playbook", outcome: "worked", at: 1001 });
    const reopened = new Playbook(path);
    expect(reopened.entries()).toHaveLength(1);
    expect(reopened.trust(id)?.verdict).toBe("trusted");
  });

  it("recall() hides suspect fixes so the ladder never recommends a known-bad one", () => {
    const path = tmp();
    const pb = new Playbook(path);
    const id = pb.add(entry(), 1);
    pb.logApplication({ signature: entry().signature, entryId: id, model: "strong", contextLevel: "escalated", outcome: "failed", at: 2 });
    expect(pb.trust(id)?.verdict).toBe("suspect");
    expect(pb.recall("Cannot use import statement outside a module")).toHaveLength(0);
  });

  it("recommendStart routes: cheapest known-good level, or escalate on a gap", () => {
    const path = tmp();
    const pb = new Playbook(path);
    const sig = fingerprint("Cannot use import statement outside a module");
    expect(pb.recommendStart("gemma", sig)).toBe("bare"); // unknown → try cheap first
    pb.logApplication({ signature: sig, model: "gemma", contextLevel: "playbook", outcome: "worked", at: 1 });
    expect(pb.recommendStart("gemma", sig)).toBe("playbook"); // learned: start where it succeeds

    const hard = fingerprint("module federation shared singleton version mismatch");
    pb.logApplication({ signature: hard, model: "gemma", contextLevel: "research", outcome: "failed", at: 2 });
    expect(pb.recommendStart("gemma", hard)).toBe("escalate"); // gap → straight to the senior
  });
});

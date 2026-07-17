import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Playbook } from "../src/core/playbook";
import { seedPlaybook, seedCount } from "../src/core/playbook-seed";
import { DIAGNOSES } from "../src/core/diagnose";

const tmp = (): Playbook => new Playbook(join(mkdtempSync(join(tmpdir(), "pbseed-")), "playbook.json"));

describe("playbook seeding (diagnose registry + runnability classes)", () => {
  it("seeds every known fix — diagnose-derived plus the runnability-gate classes", () => {
    const pb = tmp();
    const added = seedPlaybook(pb, 1);
    expect(added).toBe(seedCount());
    expect(added).toBeGreaterThan(DIAGNOSES.length); // runnability seeds are on top of the diagnose ones
    expect(pb.entries().every((e) => e.source === "seeded")).toBe(true);
    expect(pb.entries().some((e) => e.context === "runnability")).toBe(true);
  });

  it("recalls a fix for the exact runnability failure the live run hit (cold playbook)", () => {
    const pb = tmp();
    seedPlaybook(pb, 1);
    const hits = pb.recall(`package.json: the "start" script runs "index.js", which does not exist — create it or fix the script.`);
    expect(hits[0]?.title).toMatch(/start script points at a missing entry/i);
    expect(hits[0]?.solution).toMatch(/app\.listen\(process\.env\.PORT\)/);
  });

  it("is idempotent — a second seed adds nothing", () => {
    const pb = tmp();
    seedPlaybook(pb, 1);
    const n = pb.entries().length;
    expect(seedPlaybook(pb, 2)).toBe(0);
    expect(pb.entries()).toHaveLength(n);
  });

  it("makes real errors recall a fix on a COLD playbook (never learned anything yet)", () => {
    const pb = tmp();
    seedPlaybook(pb, 1);
    // A genuine boot crash from a fresh project — no prior history at all.
    const esm = pb.recall("SyntaxError: Cannot use import statement outside a module in routes/auth.js");
    expect(esm[0]?.title).toMatch(/ESM\/CJS/i);
    expect(esm[0]?.solution).toContain("import/export");

    const port = pb.recall("Error: listen EADDRINUSE: address already in use :::3000");
    expect(port[0]?.title).toMatch(/port/i);
    expect(port[0]?.solution).toMatch(/process\.env\.PORT/);
  });
});

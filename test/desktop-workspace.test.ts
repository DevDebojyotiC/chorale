import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { needsSeed, firstRunSeed, agentCount } from "../desktop/workspace";

describe("Phase 5 — workspace first-run seeding", () => {
  let root: string;
  let defaults: string;
  let ws: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "chorale-ws-"));
    defaults = join(root, "defaults");
    ws = join(root, "workspace");
    mkdirSync(join(defaults, "config"), { recursive: true });
    mkdirSync(join(defaults, "agents"), { recursive: true });
    writeFileSync(join(defaults, "config", "chorale.config.json5"), "{ base: { model: 'x' } }");
    writeFileSync(join(defaults, "agents", "coder.md"), "---\nname: coder\n---\nhi");
    writeFileSync(join(defaults, "agents", "coder.examples.md"), "examples");
    writeFileSync(join(defaults, ".env.example"), "ZAI_API_KEY=\n");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("needsSeed is true for an empty workspace, false once seeded", () => {
    expect(needsSeed(ws)).toBe(true);
    expect(firstRunSeed(ws, defaults)).toBe(true);
    expect(needsSeed(ws)).toBe(false);
  });

  it("seeds config + agents + a starter .env from the example", () => {
    firstRunSeed(ws, defaults);
    expect(existsSync(join(ws, "config", "chorale.config.json5"))).toBe(true);
    expect(existsSync(join(ws, "agents", "coder.md"))).toBe(true);
    expect(readFileSync(join(ws, ".env"), "utf8")).toContain("ZAI_API_KEY=");
  });

  it("is a no-op when already seeded (never clobbers an edited config)", () => {
    firstRunSeed(ws, defaults);
    writeFileSync(join(ws, "config", "chorale.config.json5"), "{ EDITED: true }");
    expect(firstRunSeed(ws, defaults)).toBe(false); // does not re-seed
    expect(readFileSync(join(ws, "config", "chorale.config.json5"), "utf8")).toContain("EDITED");
  });

  it("does not overwrite an existing .env", () => {
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, ".env"), "ZAI_API_KEY=secret\n");
    firstRunSeed(ws, defaults);
    expect(readFileSync(join(ws, ".env"), "utf8")).toContain("secret");
  });

  it("returns false when the defaults are missing (caller falls back)", () => {
    expect(firstRunSeed(ws, join(root, "nonexistent"))).toBe(false);
    expect(needsSeed(ws)).toBe(true);
  });

  it("agentCount excludes *.examples.md", () => {
    firstRunSeed(ws, defaults);
    expect(agentCount(ws)).toBe(1); // coder.md, not coder.examples.md
  });
});

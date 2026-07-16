import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadAgent } from "../src/agents/loader";

describe("Phase 4 — generalized gate framework (config)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chorale-gates-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (name: string, frontmatter: string): string => {
    const p = join(dir, `${name}.md`);
    writeFileSync(p, `---\nname: ${name}\ndescription: test agent\n${frontmatter}---\n\npersona\n`, "utf8");
    return p;
  };

  it("legacy reviewGate translates to an implicit auto reviewer gate (behavior preserved)", () => {
    // coder relies on reviewGate defaulting on → should carry an auto post-verify reviewer gate
    const coder = loadAgent(resolve("agents/coder.md"));
    expect(coder.reviewGate).toBe(true); // legacy field still readable
    expect(coder.gates).toContainEqual({ agent: "reviewer", mode: "auto", when: "post-verify" });
    // reviewer/scribe opt out (reviewGate: false) → no implicit reviewer gate
    expect(loadAgent(resolve("agents/reviewer.md")).gates.some((g) => g.agent === "reviewer")).toBe(false);
    expect(loadAgent(resolve("agents/scribe.md")).gates.some((g) => g.agent === "reviewer")).toBe(false);
  });

  it("parses an explicit gates allow-list with auto and on-demand modes", () => {
    const p = write("planful", "reviewGate: false\ngates:\n  - agent: planner\n    mode: auto\n    when: pre\n  - agent: reviewer\n    mode: on-demand\n");
    const spec = loadAgent(p);
    expect(spec.gates).toContainEqual({ agent: "planner", mode: "auto", when: "pre" });
    expect(spec.gates).toContainEqual({ agent: "reviewer", mode: "on-demand", when: "post-verify" });
  });

  it("a bare agent name is an on-demand gate", () => {
    const p = write("ondemand", "reviewGate: false\ngates: [planner]\n");
    expect(loadAgent(p).gates).toEqual([{ agent: "planner", mode: "on-demand", when: "post-verify" }]);
  });

  it("an explicit reviewer gate is not duplicated by the legacy translation", () => {
    const p = write("explicit", "gates:\n  - agent: reviewer\n    mode: auto\n    when: pre\n");
    const reviewerGates = loadAgent(p).gates.filter((g) => g.agent === "reviewer");
    expect(reviewerGates).toEqual([{ agent: "reviewer", mode: "auto", when: "pre" }]); // the explicit one wins; no dup
  });

  it("no gates when reviewGate is off and none declared", () => {
    const p = write("bare", "reviewGate: false\n");
    expect(loadAgent(p).gates).toEqual([]);
  });
});

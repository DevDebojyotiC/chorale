import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFileTools, WRITE_FILE_TOOLS } from "../src/tools/fs";
import { buildToolSet } from "../src/tools/registry";
import { loadAgent } from "../src/agents/loader";
import { extractPathRefs, checkGroundedness, groundednessFeedback } from "../src/core/ground";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = (t: any) => (i: any) => t.execute(i, {});

describe("Phase 4 — scribe move tool (reference-safe file ops)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chorale-scribe-"));
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "guide.md"), "# Guide\n");
    writeFileSync(join(dir, "docs", "intro.md"), "See [the guide](../guide.md).\n");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("moves a file and reports the references to update", async () => {
    const move = exec(createFileTools({ mode: "full-auto", cwd: dir }).move!);
    const res = await move({ from: "guide.md", to: "user-guide.md" });
    expect(res.moved).toBe(true);
    expect(existsSync(join(dir, "user-guide.md"))).toBe(true);
    expect(existsSync(join(dir, "guide.md"))).toBe(false);
    // the referencing file is surfaced so its link can be fixed
    expect(res.references.some((r: { file: string }) => r.file === "docs/intro.md")).toBe(true);
  });

  it("refuses to overwrite an existing destination and a missing source", async () => {
    const move = exec(createFileTools({ mode: "full-auto", cwd: dir }).move!);
    writeFileSync(join(dir, "taken.md"), "x");
    expect((await move({ from: "guide.md", to: "taken.md" })).error).toMatch(/already exists/);
    expect((await move({ from: "nope.md", to: "whatever.md" })).error).toMatch(/not found/);
    expect(existsSync(join(dir, "guide.md"))).toBe(true); // unchanged after failed moves
  });

  it("stays inside the workspace sandbox", async () => {
    const move = exec(createFileTools({ mode: "full-auto", cwd: dir }).move!);
    expect((await move({ from: "guide.md", to: "../escape.md" })).error).toMatch(/escapes/);
  });

  it("is a mutating tool — omitted in read-only mode, present in auto-edit", () => {
    expect(WRITE_FILE_TOOLS.has("move")).toBe(true);
    const names = ["read", "move"];
    expect(Object.keys(buildToolSet(names, { mode: "read-only", cwd: dir }))).not.toContain("move");
    expect(Object.keys(buildToolSet(names, { mode: "auto-edit", cwd: dir }))).toContain("move");
  });
});

describe("Phase 4 — scribe groundedness check (anti-hallucination)", () => {
  it("extracts markdown link targets and backticked repo paths, not urls/anchors/bare words", () => {
    const refs = extractPathRefs(
      "See [guide](docs/guide.md) and [site](https://x.com) and [top](#intro). Run `src/index.ts`; use `npm test`; edit `config.yaml`.",
    );
    expect(refs).toContain("docs/guide.md"); // relative link
    expect(refs).toContain("src/index.ts"); // backticked path (slash + ext)
    expect(refs).not.toContain("https://x.com"); // url skipped
    expect(refs).not.toContain("#intro"); // anchor skipped
    expect(refs).not.toContain("npm test"); // not a path
    expect(refs).not.toContain("config.yaml"); // bare filename (no slash) — too ambiguous
  });

  it("flags a referenced path that does not exist, passes one that does", () => {
    const dir = mkdtempSync(join(tmpdir(), "chorale-ground-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;");
      writeFileSync(join(dir, "README.md"), "Real: [x](src/index.ts). Fake: [y](src/nope.ts).");
      const missing = checkGroundedness(["README.md"], dir);
      expect(missing.map((m) => m.ref)).toEqual(["src/nope.ts"]);
      expect(groundednessFeedback(missing)).toMatch(/src\/nope\.ts/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Phase 4 — scribe agent", () => {
  it("loads as a docs agent: authors + moves files, groundCheck on, code-loops off", () => {
    const s = loadAgent(resolve("agents/scribe.md"));
    expect(s.name).toBe("scribe");
    expect(s.delegable).toBe(true);
    expect(s.tools).toEqual(expect.arrayContaining(["read", "grep", "write", "edit", "move"]));
    // Its verification is groundedness, not the code loops.
    expect(s.groundCheck).toBe(true);
    expect(s.selfCritique).toBe(true);
    expect(s.verify).toBe(false);
    expect(s.reviewGate).toBe(false);
    // groundCheck is opt-in: the coder doesn't get it.
    expect(loadAgent(resolve("agents/coder.md")).groundCheck).toBe(false);
  });
});

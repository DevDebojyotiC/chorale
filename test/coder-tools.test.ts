import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileTools } from "../src/tools/fs";
import { createShellTools } from "../src/tools/shell";
import { buildToolSet } from "../src/tools/registry";
import { resolveInside, isCatastrophic } from "../src/tools/permissions";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "chorale-test-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), "export const x = 1;\nconst y = 2;\n");
  writeFileSync(join(dir, "README.md"), "# Hello\nworld\n");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = (t: any) => (i: any) => t.execute(i, {});

describe("Phase 2 — permissions", () => {
  it("sandboxes paths to the workspace", () => {
    expect(() => resolveInside(dir, "src/a.ts")).not.toThrow();
    expect(() => resolveInside(dir, "../../etc/passwd")).toThrow(/escapes/);
  });
  it("flags catastrophic shell commands", () => {
    expect(isCatastrophic("rm -rf /")).toBe(true);
    expect(isCatastrophic("rm -rf ~")).toBe(true);
    expect(isCatastrophic("shutdown now")).toBe(true);
    expect(isCatastrophic("npm test")).toBe(false);
    expect(isCatastrophic("git commit -m 'rm stuff'")).toBe(false);
  });
});

describe("Phase 2 — buildToolSet gating by mode", () => {
  const names = ["read", "ls", "glob", "grep", "write", "edit", "multi_edit", "bash"];
  it("read-only exposes only read tools", () => {
    const t = buildToolSet(names, { mode: "read-only", cwd: dir });
    expect(Object.keys(t).sort()).toEqual(["glob", "grep", "ls", "read"]);
  });
  it("auto-edit adds write tools and bash", () => {
    const t = buildToolSet(names, { mode: "auto-edit", cwd: dir });
    expect(Object.keys(t)).toEqual(expect.arrayContaining(["write", "edit", "multi_edit", "bash"]));
  });
  it("full-auto exposes everything", () => {
    const t = buildToolSet(names, { mode: "full-auto", cwd: dir });
    expect(Object.keys(t).length).toBe(names.length);
  });
});

describe("Phase 2 — file tools (workspace-sandboxed)", () => {
  let tools: ReturnType<typeof createFileTools>;
  beforeAll(() => {
    tools = createFileTools({ mode: "full-auto", cwd: dir });
  });

  it("write then read round-trips", async () => {
    await exec(tools.write)({ path: "note.txt", content: "hi there" });
    expect((await exec(tools.read)({ path: "note.txt" })).content).toBe("hi there");
  });
  it("edit replaces a unique string and errors when missing", async () => {
    expect((await exec(tools.edit)({ path: "note.txt", old_string: "hi", new_string: "hey" })).ok).toBe(true);
    expect((await exec(tools.read)({ path: "note.txt" })).content).toBe("hey there");
    expect((await exec(tools.edit)({ path: "note.txt", old_string: "nope", new_string: "x" })).error).toMatch(/not found/);
  });
  it("multi_edit applies edits in order", async () => {
    await exec(tools.write)({ path: "m.txt", content: "a b c" });
    const r = await exec(tools.multi_edit)({ path: "m.txt", edits: [{ old_string: "a", new_string: "1" }, { old_string: "c", new_string: "3" }] });
    expect(r.ok).toBe(true);
    expect((await exec(tools.read)({ path: "m.txt" })).content).toBe("1 b 3");
  });
  it("glob matches by pattern", async () => {
    expect((await exec(tools.glob)({ pattern: "src/**/*.ts" })).matches).toContain("src/a.ts");
  });
  it("grep finds matching lines", async () => {
    const files = (await exec(tools.grep)({ pattern: "const y" })).matches.map((m: { file: string }) => m.file);
    expect(files).toContain("src/a.ts");
  });
  it("refuses to read outside the workspace", async () => {
    expect((await exec(tools.read)({ path: "../../../etc/passwd" })).error).toMatch(/escapes/);
  });
});

describe("Phase 2 — shell tool", () => {
  let bash: ReturnType<typeof createShellTools>["bash"];
  beforeAll(() => {
    bash = createShellTools({ mode: "full-auto", cwd: dir }).bash;
  });
  it("runs a safe command in full-auto", async () => {
    expect(String((await exec(bash)({ command: "echo hello" })).stdout)).toMatch(/hello/);
  });
  it("refuses catastrophic commands even in full-auto", async () => {
    expect((await exec(bash)({ command: "rm -rf /" })).error).toMatch(/denylist|refused/i);
  });
});

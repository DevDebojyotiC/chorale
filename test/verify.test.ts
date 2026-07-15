import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyFiles } from "../src/core/verify";
import { createFileTools } from "../src/tools/fs";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "chorale-verify-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = (t: any) => (i: any) => t.execute(i, {});

describe("Phase 2 — code verification", () => {
  it("passes valid JS, HTML, and JSON", async () => {
    writeFileSync(join(dir, "ok.js"), "const x = 1;\nfunction f() { return x; }\n");
    writeFileSync(join(dir, "ok.html"), "<html><body><script>const y = 2; console.log(y);</script></body></html>");
    writeFileSync(join(dir, "ok.json"), '{"a":1,"b":[2,3]}');
    expect(await verifyFiles(["ok.js", "ok.html", "ok.json"], dir)).toEqual([]);
  });

  it("catches a JS syntax error (literal backslash-n in code)", async () => {
    writeFileSync(join(dir, "bad.js"), "function f() { doThing();\\n }\n");
    const issues = await verifyFiles(["bad.js"], dir);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.file).toBe("bad.js");
  });

  it("catches a broken inline <script> in HTML (the todo-app bug)", async () => {
    writeFileSync(join(dir, "bad.html"), "<html><body><script>function f() { save();\\n }</script></body></html>");
    const issues = await verifyFiles(["bad.html"], dir);
    expect(issues.some((i) => /script/i.test(i.message))).toBe(true);
  });

  it("catches invalid JSON", async () => {
    writeFileSync(join(dir, "bad.json"), '{ "a": 1, }');
    expect((await verifyFiles(["bad.json"], dir)).length).toBe(1);
  });
});

describe("Phase 2 — source-side unescape (write tool)", () => {
  it("unescapes a fully-escaped single-line code blob and it verifies clean", async () => {
    const tools = createFileTools({ mode: "full-auto", cwd: dir });
    await exec(tools.write)({ path: "escaped.js", content: "const a=1;\\nconst b=2;\\nfunction f(){ return a+b; }" });
    const written = readFileSync(join(dir, "escaped.js"), "utf8");
    expect(written).toContain("\n");
    expect(written).not.toMatch(/\\n/);
    expect(await verifyFiles(["escaped.js"], dir)).toEqual([]);
  });

  it("leaves legitimate multi-line code (with \\n inside a string) untouched", async () => {
    const tools = createFileTools({ mode: "full-auto", cwd: dir });
    const content = 'const s = "line1\\nline2";\nconsole.log(s);\n';
    await exec(tools.write)({ path: "keep.js", content });
    expect(readFileSync(join(dir, "keep.js"), "utf8")).toBe(content);
  });
});

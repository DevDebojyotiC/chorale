import { describe, it, expect } from "vitest";
import { diagnose } from "../src/core/diagnose";
import { verifyFeedback } from "../src/core/verify";

describe("Phase 2 — diagnose-and-compensate registry", () => {
  it("names the file-based fix for a backtick / template-literal error", () => {
    const out = diagnose(['Syntax error "`" (line 193)']);
    expect(out).toMatch(/template-literal/i);
    expect(out).toMatch(/separate file|readFileSync/i);
  });

  it("flags ESM/CJS mismatch", () => {
    expect(diagnose(["require is not defined in ES module scope"])).toMatch(/ESM\/CJS|import\/export/i);
    expect(diagnose(["Cannot use import statement outside a module"])).toMatch(/ES module/i);
  });

  it("flags a bad module path", () => {
    expect(diagnose(["Cannot find module './util'"])).toMatch(/module path is wrong|file extension/i);
  });

  it("flags a hardcoded port on EADDRINUSE", () => {
    expect(diagnose(["Error: listen EADDRINUSE: address already in use :::3000"])).toMatch(/process\.env\.PORT/);
  });

  it("flags undefined names and non-function calls", () => {
    expect(diagnose(["foo is not defined"])).toMatch(/declared or imported/i);
    expect(diagnose(["x.run is not a function"])).toMatch(/isn't a function|export name/i);
  });

  it("flags a ts-node startup crash and steers to tsx (the BookIt boot failure)", () => {
    const out = diagnose(["TypeError: Cannot read properties of undefined (reading 'fileExists')", "at readConfig (node_modules/ts-node/dist/configuration.js:91)"]);
    expect(out).toMatch(/tsx/);
    expect(out).toMatch(/ts-node/);
  });

  it("flags a sqlite open failure caused by a missing directory", () => {
    const out = diagnose(["TypeError: Cannot open database because the directory does not exist"]);
    expect(out).toMatch(/mkdirSync/);
    expect(out).toMatch(/directory/i);
  });

  it("returns empty for an unrecognized error", () => {
    expect(diagnose(["some totally novel failure 42"])).toBe("");
  });

  it("dedupes and combines multiple matches", () => {
    const out = diagnose(["Cannot find module './x'", "require is not defined"]);
    expect((out.match(/•/g) ?? []).length).toBe(2);
  });

  it("verifyFeedback embeds the targeted diagnosis", () => {
    const fb = verifyFeedback([{ file: "server.mjs", message: 'Syntax error "`" (line 12)' }]);
    expect(fb).toMatch(/Likely cause/i);
    expect(fb).toMatch(/readFileSync|separate file/i);
  });
});

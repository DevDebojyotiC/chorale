import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkStaticPages } from "../src/core/smoke";
import { headlessAvailable, htmlToText } from "../src/core/headless";

let dir: string;

const MODULE_PAGE = `<!DOCTYPE html><html><body>
  <div id="board"></div>
  <script type="module" src="./app.js"></script>
</body></html>`;

const INLINE_PAGE = `<!DOCTYPE html><html><body>
  <h1>Hi</h1><div id="board"></div>
  <script>document.getElementById('board').textContent = 'rendered';</script>
</body></html>`;

const STATIC_PAGE = `<!DOCTYPE html><html><body><h1>Just static text</h1></body></html>`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "chorale-static-"));
  writeFileSync(join(dir, "module.html"), MODULE_PAGE);
  writeFileSync(join(dir, "inline.html"), INLINE_PAGE);
  writeFileSync(join(dir, "app.js"), "document.getElementById('board').textContent='x';");
  writeFileSync(join(dir, "static.html"), STATIC_PAGE);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("static-page verification", () => {
  it("flags a relative ES-module script (blocked over file://) — deterministic, no browser", async () => {
    const issues = await checkStaticPages(["module.html"], dir);
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toMatch(/module/i);
    expect(issues[0]!.message).toMatch(/file:\/\//);
  });

  it("does NOT flag a self-contained inline-script page", async () => {
    const issues = await checkStaticPages(["inline.html"], dir);
    expect(issues).toEqual([]);
  });

  it("ignores a purely static page with no scripts", async () => {
    const issues = await checkStaticPages(["static.html"], dir);
    expect(issues).toEqual([]);
  });

  it("htmlToText strips tags/scripts to visible text", () => {
    expect(htmlToText("<body><h1>Hello</h1><script>var x=1</script> world</body>")).toBe("Hello world");
  });

  it("(smoke) reports whether a headless browser is available", () => {
    expect(typeof headlessAvailable()).toBe("boolean"); // env-dependent; just exercise the path
  });

  // Headless render checks only run where a system browser exists (skipped on a browserless CI).
  it.skipIf(!headlessAvailable())("flags a page that renders blank because its script throws on load", async () => {
    writeFileSync(join(dir, "throws.html"), `<!DOCTYPE html><html><body><div id="app"></div><script>throw new Error("boom");</script></body></html>`);
    const issues = await checkStaticPages(["throws.html"], dir);
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toMatch(/blank/i);
  });

  it.skipIf(!headlessAvailable())("does NOT flag an inline page that actually builds its DOM", async () => {
    writeFileSync(join(dir, "builds.html"), `<!DOCTYPE html><html><body><script>document.body.innerHTML="<h1>Hello world</h1>";</script></body></html>`);
    const issues = await checkStaticPages(["builds.html"], dir);
    expect(issues).toEqual([]);
  });
});

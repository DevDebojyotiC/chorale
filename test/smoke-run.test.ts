import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { detectServerEntry, pickProbes, classifyProbes, smokeRunFeedback, ensureServerDeps, npmError, type Probe } from "../src/core/smoke-run";
import type { SourceFile } from "../src/core/contract";

describe("Phase 4 — dynamic boot gate (fullstack frontier)", () => {
  it("detects the backend server entry (the file that listens)", () => {
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" }, scripts: { start: "node server.js" } }) },
      { path: "backend/server.js", content: "const app=require('express')(); app.listen(process.env.PORT);" },
      { path: "backend/routes/auth.js", content: "module.exports = {}" },
      { path: "frontend/package.json", content: JSON.stringify({ dependencies: { react: "^18" } }) },
    ];
    expect(detectServerEntry(files)).toEqual({ dir: "backend", entry: "server.js" });
  });

  it("returns null when there is no server to boot", () => {
    const files: SourceFile[] = [{ path: "frontend/package.json", content: JSON.stringify({ dependencies: { react: "^18" } }) }, { path: "frontend/src/App.js", content: "export default function App(){}" }];
    expect(detectServerEntry(files)).toBeNull();
  });

  it("picks a base GET and a register/create POST from the contract", () => {
    const probes = pickProbes({ baseUrl: "http://localhost:3000", endpoints: ["POST /api/auth/register", "POST /api/auth/login", "GET /api/notes"], tables: [], exports: [] });
    expect(probes[0]).toMatchObject({ method: "GET", path: "/" });
    expect(probes.some((p) => p.method === "POST" && p.path === "/api/auth/register" && p.body)).toBe(true);
  });

  it("params in a probed path are made concrete", () => {
    const probes = pickProbes({ endpoints: ["POST /users/:id/notes"], tables: [], exports: [] });
    expect(probes.find((p) => p.method === "POST")!.path).toBe("/users/1/notes");
  });

  it("strips extractContract's human-readable note so the probe path is a legal URL", () => {
    // The real SupportDesk endpoint. The note's spaces/parens made http.request throw
    // "Request path contains unescaped characters" — which killed an entire 89-minute run.
    const probes = pickProbes({ endpoints: ["POST /  (defined in backend/src/routes/ticket.routes)", "GET /tickets/:id  (defined in backend/src/routes/ticket.routes)"], tables: [], exports: [] });
    for (const p of probes) {
      expect(p.path).not.toMatch(/\s|\(|\)/); // no whitespace or parens ever reach http.request
      expect(() => {
        const req = http.request({ host: "127.0.0.1", port: 1, path: p.path, method: p.method });
        req.on("error", () => {}); // nothing is listening on port 1 — we only care that it didn't THROW
        req.destroy();
      }).not.toThrow();
    }
  });

  it("classifies only 5xx as a server bug (4xx and unreachable are fine)", () => {
    const p: Probe = { method: "POST", path: "/register" };
    expect(classifyProbes([{ probe: p, status: 500 }])).toHaveLength(1);
    expect(classifyProbes([{ probe: p, status: 400 }])).toEqual([]); // validation error = client's fault, fine
    expect(classifyProbes([{ probe: p, status: 201 }])).toEqual([]);
    expect(classifyProbes([{ probe: p, error: "ECONNREFUSED" }])).toEqual([]); // path not served — don't over-flag
    expect(classifyProbes([{ probe: p, status: 502 }])[0]!.kind).toBe("server-error");
  });

  it("ensureServerDeps skips (no install) when there is no server module to boot", () => {
    const files: SourceFile[] = [{ path: "frontend/package.json", content: JSON.stringify({ dependencies: { react: "^18" } }) }];
    const r = ensureServerDeps("/nonexistent-cwd", files);
    expect(r.installed).toBe(false);
    expect(r.reason).toMatch(/no server/i); // returns cleanly, never throws or shells out
  });

  it("ensureServerDeps NEVER runs npm in a directory without its own package.json", () => {
    // Guard against polluting a parent repo: `npm install` in a dir with no package.json walks UP and
    // installs into whatever manifest sits above it. The install must be refused before it shells out.
    const dir = mkdtempSync(join(tmpdir(), "nopkg-")); // exists on disk, but has NO package.json
    const files: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) }, // claimed, not on disk
      { path: "server.js", content: "const app=require('express')(); app.listen(process.env.PORT);" },
    ];
    const r = ensureServerDeps(dir, files);
    expect(r.installed).toBe(false);
    expect(r.reason).toBe("no package.json"); // refused at the guard — npm was never invoked
  });

  it("npmError extracts the actionable npm failure and drops boilerplate", () => {
    // Without this, the repair only sees "Command failed: npm.cmd install" and cannot know what to fix.
    const stderr = [
      "npm error code ETARGET",
      "npm error notarget No matching version found for bcryptjs@^2.4.10.",
      "npm error notarget In most cases you or one of your dependencies are",
      "npm error A complete log of this run can be found in: C:\\Users\\x\\npm-cache\\_logs\\2026-07-17T06_07_05_335Z-debug-0.log",
    ].join("\n");
    const e = npmError(stderr);
    expect(e).toMatch(/No matching version found for bcryptjs@\^2\.4\.10/); // names the actual bad dep
    expect(e).not.toMatch(/complete log/i); // boilerplate dropped
    expect(e).not.toMatch(/npm error/); // prefix stripped
  });

  it("smokeRunFeedback turns issues into a fix instruction", () => {
    const fb = smokeRunFeedback([{ kind: "boot-failed", message: "the backend crashed on startup: SyntaxError" }]);
    expect(fb).toMatch(/does not run/i);
    expect(fb).toMatch(/SyntaxError/);
  });
});

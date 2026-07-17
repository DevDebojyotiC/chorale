import { describe, it, expect } from "vitest";
import { detectServerEntry, pickProbes, classifyProbes, smokeRunFeedback, type Probe } from "../src/core/smoke-run";
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

  it("classifies only 5xx as a server bug (4xx and unreachable are fine)", () => {
    const p: Probe = { method: "POST", path: "/register" };
    expect(classifyProbes([{ probe: p, status: 500 }])).toHaveLength(1);
    expect(classifyProbes([{ probe: p, status: 400 }])).toEqual([]); // validation error = client's fault, fine
    expect(classifyProbes([{ probe: p, status: 201 }])).toEqual([]);
    expect(classifyProbes([{ probe: p, error: "ECONNREFUSED" }])).toEqual([]); // path not served — don't over-flag
    expect(classifyProbes([{ probe: p, status: 502 }])[0]!.kind).toBe("server-error");
  });

  it("smokeRunFeedback turns issues into a fix instruction", () => {
    const fb = smokeRunFeedback([{ kind: "boot-failed", message: "the backend crashed on startup: SyntaxError" }]);
    expect(fb).toMatch(/does not run/i);
    expect(fb).toMatch(/SyntaxError/);
  });
});

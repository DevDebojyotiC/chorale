import { describe, it, expect } from "vitest";
import { checkRunnable, runnableFeedback } from "../src/core/runnable";
import type { SourceFile } from "../src/core/contract";

const pathsOf = (files: SourceFile[], extra: string[] = []): Set<string> => new Set([...files.map((f) => f.path), ...extra]);

describe("Phase 4 — runnability gate (fullstack lever #3)", () => {
  it("flags a backend with no server entry point (the exact experiment-3 failure)", () => {
    // express dep + controllers/models, but NOTHING calls .listen() → the server never boots
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "backend/src/controllers/auth.controller.js", content: "exports.login = (req,res)=>{}" },
      { path: "backend/src/models/db.js", content: "module.exports = {}" },
    ];
    const issues = checkRunnable(files, pathsOf(files));
    expect(issues.some((i) => i.kind === "no-entry")).toBe(true);
  });

  it("passes a backend that actually starts a server", () => {
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" }, scripts: { start: "node src/server.js" } }) },
      { path: "backend/src/server.js", content: "const app = require('./app'); app.listen(3000);" },
      { path: "backend/src/app.js", content: "const express=require('express'); const app=express(); module.exports=app;" },
    ];
    expect(checkRunnable(files, pathsOf(files))).toEqual([]);
  });

  it("flags a start script that points at a missing file", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ dependencies: { express: "^4" }, scripts: { start: "node server.js" } }) },
      { path: "app.js", content: "const app=require('express')(); app.listen(3000);" }, // server exists, but start points elsewhere
    ];
    const issues = checkRunnable(files, pathsOf(files));
    expect(issues.some((i) => i.kind === "broken-start")).toBe(true);
  });

  it("flags a missing local import (incoherence)", () => {
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "backend/src/app.js", content: "const routes = require('./routes/auth.routes');\nconst app=require('express')(); app.use('/auth', routes); app.listen(3000);" },
    ];
    // ./routes/auth.routes does NOT exist → missing-import
    const issues = checkRunnable(files, pathsOf(files));
    expect(issues.some((i) => i.kind === "missing-import" && i.message.includes("auth.routes"))).toBe(true);
  });

  it("does not flag a local import that resolves (incl. index and extensions)", () => {
    const files: SourceFile[] = [
      { path: "src/index.js", content: "const u = require('./user'); const r = require('./routes');" },
      { path: "src/user.js", content: "module.exports = {}" },
      { path: "src/routes/index.js", content: "module.exports = {}" }, // ./routes → ./routes/index.js
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "missing-import")).toBe(false);
  });

  it("flags required env with no .env (the experiment-1 login/JWT_SECRET gap)", () => {
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4", jsonwebtoken: "^9" }, scripts: { start: "node server.js" } }) },
      { path: "backend/server.js", content: "const s = process.env.JWT_SECRET; require('express')().listen(3000);" },
    ];
    // only .env.example is present, no .env
    const paths = pathsOf(files, ["backend/.env.example"]);
    const issues = checkRunnable(files, paths);
    expect(issues.some((i) => i.kind === "missing-env")).toBe(true);
    // with a real .env, no missing-env
    expect(checkRunnable(files, pathsOf(files, ["backend/.env"])).some((i) => i.kind === "missing-env")).toBe(false);
  });

  it("flags route files that exist but are never mounted (the e2e 'boots but API is dead' failure)", () => {
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      // server boots (has .listen) but only serves /health — never mounts the routers
      { path: "backend/server.js", content: "const express=require('express');const app=express();app.get('/health',(q,r)=>r.send('ok'));app.listen(5000);module.exports=app;" },
      { path: "backend/routes/authRoutes.js", content: "const router=require('express').Router();router.post('/login',h);module.exports=router;" },
      { path: "backend/routes/notesRoutes.js", content: "const router=require('express').Router();router.get('/',h);module.exports=router;" },
    ];
    const issues = checkRunnable(files, pathsOf(files));
    const unmounted = issues.filter((i) => i.kind === "unmounted-routes");
    expect(unmounted).toHaveLength(2); // both route files are unmounted
    expect(issues.some((i) => i.kind === "no-entry")).toBe(false); // the server DOES start — that's not the problem
  });

  it("does not flag routers that ARE mounted", () => {
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "backend/server.js", content: "const express=require('express');const app=express();const authRoutes=require('./routes/authRoutes');app.use('/auth', authRoutes);app.listen(5000);" },
      { path: "backend/routes/authRoutes.js", content: "const router=require('express').Router();router.post('/login',h);module.exports=router;" },
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "unmounted-routes")).toBe(false);
  });

  it("runnableFeedback lists the issues as a fix instruction", () => {
    const files: SourceFile[] = [{ path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) }, { path: "backend/x.js", content: "1" }];
    const fb = runnableFeedback(checkRunnable(files, pathsOf(files)));
    expect(fb).toMatch(/not runnable/i);
    expect(fb).toMatch(/\.listen\(\)/);
  });
});

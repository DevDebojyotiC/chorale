import { describe, it, expect } from "vitest";
import { checkRunnable, runnableFeedback, tiersOf, foundationalDirective, contractDirective, missingImportDirective, missingEndpointDirective, unrunnableEntryDirective, directiveFor, findStubEntry, RUNNABLE_TIER, type RunnableIssue } from "../src/core/runnable";
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

  it("flags a frontend that calls paths the backend doesn't serve (the all-four-run mismatch)", () => {
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "backend/server.js", content: "const express=require('express');const app=express();const a=require('./routes/auth');app.use('/api/auth',a);app.listen(3000);" },
      { path: "backend/routes/auth.js", content: "const router=require('express').Router();router.post('/login',h);router.post('/register',h);module.exports=router;" },
      // frontend calls root /login (no /api/auth prefix) → matches nothing the backend serves
      { path: "frontend/src/Login.js", content: "import axios from 'axios'; axios.post('http://localhost:3000/login', data);" },
    ];
    const issues = checkRunnable(files, pathsOf(files));
    expect(issues.some((i) => i.kind === "frontend-backend-mismatch")).toBe(true);
  });

  it("does NOT false-flag a centralized axios client (baseURL const + api.get across page files)", () => {
    // The exact modern-SPA shape that used to false-flag: BASE_URL constant, an axios.create instance,
    // and page files that call api.post('/api/auth/login') without ever mentioning axios themselves.
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "server.js", content: "const express=require('express');const app=express();const a=require('./routes/auth');app.use('/api/auth',a);app.listen(process.env.PORT);" },
      { path: "routes/auth.js", content: "const router=require('express').Router();router.post('/login',h);router.post('/register',h);module.exports=router;" },
      { path: "frontend/src/api/client.ts", content: 'import axios from "axios";\nconst BASE_URL = "http://localhost:3000";\nconst api = axios.create({ baseURL: BASE_URL });\nexport const refresh = () => axios.post(`${BASE_URL}/api/auth/refresh`);\nexport default api;' },
      { path: "frontend/src/pages/Login.tsx", content: 'import api from "../api/client";\nexport function Login(){ return api.post("/api/auth/login", {}); }' },
    ];
    // login call resolves to /api/auth/login = a real backend route → the client is aligned, no flag
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "frontend-backend-mismatch")).toBe(false);
  });

  it("does not flag a frontend that DOES call the backend's routes", () => {
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "backend/server.js", content: "const express=require('express');const app=express();const a=require('./routes/auth');app.use('/api/auth',a);app.listen(3000);" },
      { path: "backend/routes/auth.js", content: "const router=require('express').Router();router.post('/login',h);module.exports=router;" },
      { path: "frontend/src/api.js", content: "import axios from 'axios'; const API_BASE_URL='http://localhost:3000/api/auth'; export const login=(d)=>axios.post('/login', d, {baseURL: API_BASE_URL});" },
    ];
    // frontend base /api/auth + /login = /api/auth/login → matches the backend
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "frontend-backend-mismatch")).toBe(false);
  });

  it("flags a route the frontend needs but the backend never defined (base is correct)", () => {
    // The InventoryIQ/LedgerLite gap: login+register match, but /refresh is simply not implemented.
    // The app boots and serves fine, so no other gate can see this — it just 404s at runtime.
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "backend/server.js", content: "const express=require('express');const app=express();const a=require('./routes/auth');app.use('/api/auth',a);app.listen(3000);" },
      { path: "backend/routes/auth.js", content: "const router=require('express').Router();router.post('/login',h);router.post('/register',h);module.exports=router;" },
      { path: "frontend/src/api.js", content: "import axios from 'axios'; const api=axios.create({baseURL:'/'}); api.post('/api/auth/login',d); api.post('/api/auth/refresh',d);" },
    ];
    const issues = checkRunnable(files, pathsOf(files));
    expect(issues.some((i) => i.kind === "frontend-backend-mismatch")).toBe(false); // base IS right
    const miss = issues.find((i) => i.kind === "missing-endpoint");
    expect(miss?.message).toMatch(/\/api\/auth\/refresh/);
    expect(missingEndpointDirective(files)).toMatch(/ADD the missing route/);
  });

  it("ignores extractContract's note when matching paths (an unresolved mount must not false-flag)", () => {
    // When the mount can't be resolved, extractContract annotates: "GET /health  (defined in src)".
    // If the note is treated as part of the path, every comparison silently fails and a correct
    // frontend gets reported as calling routes that "don't exist".
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "backend/src/index.js", content: "const express=require('express');const app=express();app.get('/health',h);app.listen(process.env.PORT);" },
      { path: "frontend/src/api.js", content: "import axios from 'axios'; const api=axios.create({baseURL:'/'}); api.get('/health');" },
    ];
    const issues = checkRunnable(files, pathsOf(files));
    expect(issues.some((i) => i.kind === "frontend-backend-mismatch")).toBe(false);
    expect(issues.some((i) => i.kind === "missing-endpoint")).toBe(false); // /health IS served
  });

  it("does not mistake an unrelated third-party call for a missing backend route", () => {
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "backend/server.js", content: "const express=require('express');const app=express();const a=require('./routes/auth');app.use('/api/auth',a);app.listen(3000);" },
      { path: "backend/routes/auth.js", content: "const router=require('express').Router();router.post('/login',h);module.exports=router;" },
      // hits our backend AND an external service — the external one must not be reported as "missing"
      { path: "frontend/src/api.js", content: "import axios from 'axios'; const api=axios.create({baseURL:'/'}); api.post('/api/auth/login',d); axios.post('https://api.stripe.com/v1/charges',d);" },
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "missing-endpoint")).toBe(false);
  });

  it("flags a start script that runs plain node on TypeScript (the InventoryIQ .js/.ts mix)", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ type: "module", scripts: { start: "node src/index.js" }, dependencies: { express: "^4" } }) },
      { path: "src/index.js", content: "import express from 'express';\nimport authRoutes from './routes/auth.routes.ts';\nconst app=express();app.use('/api/auth',authRoutes);app.listen(process.env.PORT);" },
      { path: "src/routes/auth.routes.ts", content: "const router = {}; export default router;" },
    ];
    const i = checkRunnable(files, pathsOf(files)).find((x) => x.kind === "unrunnable-entry");
    expect(i?.message).toMatch(/node cannot execute TypeScript/);
    expect(unrunnableEntryDirective([i!])).toMatch(/tsx src\/index\.ts|node dist\/index\.js/);
  });

  it("does NOT flag TypeScript that has a real runner or a build step", () => {
    const withLoader: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ type: "module", scripts: { start: "tsx src/index.ts" }, dependencies: { express: "^4" } }) },
      { path: "src/index.ts", content: "import express from 'express'; const app=express(); app.listen(process.env.PORT);" },
    ];
    expect(checkRunnable(withLoader, pathsOf(withLoader)).some((i) => i.kind === "unrunnable-entry")).toBe(false);
    // compiled output: start points at plain .js that imports .js — perfectly runnable
    const built: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ type: "module", scripts: { build: "tsc", start: "node dist/index.js" }, dependencies: { express: "^4" } }) },
      { path: "dist/index.js", content: "import express from 'express'; const app=express(); app.listen(process.env.PORT);" },
      { path: "src/index.ts", content: "import express from 'express'; const app=express(); app.listen(process.env.PORT);" },
    ];
    expect(checkRunnable(built, pathsOf(built)).some((i) => i.kind === "unrunnable-entry")).toBe(false);
  });

  it("runnableFeedback lists the issues as a fix instruction", () => {
    const files: SourceFile[] = [{ path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) }, { path: "backend/x.js", content: "1" }];
    const fb = runnableFeedback(checkRunnable(files, pathsOf(files)));
    expect(fb).toMatch(/not runnable/i);
    expect(fb).toMatch(/\.listen\(\)/);
  });
});

describe("Phase 4 — tiered repair (foundational first)", () => {
  const mk = (kind: RunnableIssue["kind"], where = ""): RunnableIssue => ({ kind, where, message: `${kind} at ${where}` });

  it("groups issues into tiers with the missing entry point first", () => {
    const issues = [mk("unmounted-routes", "routes/a.js"), mk("frontend-backend-mismatch"), mk("no-entry", "backend"), mk("missing-env")];
    const tiers = tiersOf(issues);
    // tier 0 must be the foundational no-entry; unmounted-routes (downstream) must NOT be in tier 0
    expect(tiers[0]!.every((i) => RUNNABLE_TIER[i.kind] === 0)).toBe(true);
    expect(tiers[0]!.some((i) => i.kind === "no-entry")).toBe(true);
    expect(tiers[0]!.some((i) => i.kind === "unmounted-routes")).toBe(false);
    expect(tiers.at(-1)!.some((i) => i.kind === "frontend-backend-mismatch")).toBe(true); // contract check is last
  });

  it("the foundational directive names the exact routers to mount and the code location", () => {
    // the exact LedgerLite-run cascade: no entry + a start script pointing nowhere + three unmounted routers
    const issues = [
      mk("no-entry", "backend"),
      mk("broken-start", "package.json"),
      mk("unmounted-routes", "backend/routes/auth.js"),
      mk("unmounted-routes", "backend/routes/analytics.js"),
      mk("unmounted-routes", "backend/routes/import.js"),
    ];
    const d = foundationalDirective(issues);
    expect(d).toMatch(/mount every router/i);
    expect(d).toMatch(/backend\/routes\/auth\.js/);
    expect(d).toMatch(/backend\/routes\/analytics\.js/);
    expect(d).toMatch(/process\.env\.PORT/);
    expect(d).toMatch(/near backend/); // tells the coder to put the entry where the code actually lives
  });

  it("detects a placeholder-stub entry and tells the coder to REPLACE it (the InventoryIQ failure)", () => {
    const stubFiles: SourceFile[] = [
      { path: "src/index.js", content: "// This file marks the entry point for the backend.\n// Actual implementation will follow in subsequent steps.\n" },
      { path: "src/routes/products.js", content: "const r=require('express').Router();r.get('/',h);module.exports=r;" },
    ];
    expect(findStubEntry(stubFiles)).toBe("src/index.js");
    const d = foundationalDirective([mk("no-entry", "."), mk("unmounted-routes", "src/routes/products.js")], stubFiles);
    expect(d).toMatch(/already exists but is an EMPTY PLACEHOLDER/i);
    expect(d).toMatch(/REPLACE its entire contents/i);
    // a REAL entry (calls listen) is not a stub
    expect(findStubEntry([{ path: "src/server.js", content: "const app=require('express')();app.listen(process.env.PORT);" }])).toBeNull();
  });

  it("directiveFor picks the right focused directive for a tier, foundation first", () => {
    const files: SourceFile[] = [{ path: "src/index.js", content: "// placeholder — implementation will follow" }];
    // a tier holding the foundational kind wins, even alongside others
    expect(directiveFor([mk("no-entry", "."), mk("broken-start")], [mk("no-entry", ".")], files).text).toMatch(/EMPTY PLACEHOLDER|server entry/i);
    expect(directiveFor([mk("unrunnable-entry")], [mk("unrunnable-entry")], files).note).toMatch(/start command/i);
    expect(directiveFor([mk("missing-env")], [mk("missing-env")], files).text).toBe(""); // no special directive
  });

  it("the missing-import directive hints a misplaced module and says CREATE for a truly missing one", () => {
    const files: SourceFile[] = [
      // imports ../db/pool.js — no such file, but a 'pool' module exists elsewhere → hint to point there
      { path: "src/repositories/order.repo.ts", content: "import { pool } from '../db/pool.js';" },
      { path: "src/database/pool.ts", content: "export const pool = {};" },
      // imports ../utils/errors.js — genuinely never created → CREATE
      { path: "src/services/order.service.ts", content: "import { AppError } from '../utils/errors.js';" },
    ];
    const issues = checkRunnable(files, pathsOf(files)).filter((i) => i.kind === "missing-import");
    const d = missingImportDirective(issues, files);
    expect(d).toMatch(/A module named the same exists at "src\/database\/pool\.ts"/); // misplaced → point there
    expect(d).toMatch(/utils\/errors\.js", which was never created — CREATE/); // genuinely missing → create
  });

  it("the contract directive gives BOTH sides concretely and names the frontend client to edit", () => {
    // backend serves /api/auth/login; frontend calls root /login → mismatch (the proven-triggering setup)
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "backend/server.js", content: "const express=require('express');const app=express();const a=require('./routes/auth');app.use('/api/auth',a);app.listen(3000);" },
      { path: "backend/routes/auth.js", content: "const router=require('express').Router();router.post('/login',h);router.post('/register',h);module.exports=router;" },
      { path: "frontend/src/Login.js", content: "import axios from 'axios'; axios.post('http://localhost:3000/login', data);" },
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "frontend-backend-mismatch")).toBe(true); // precondition
    const d = contractDirective(files);
    expect(d).toMatch(/source of truth/i);
    expect(d).toMatch(/Backend actually serves:/);
    expect(d).toMatch(/\/api\/auth\/login/); // the real backend path, concretely
    expect(d).toMatch(/frontend\/src\/Login\.js/); // the file to edit
  });
});

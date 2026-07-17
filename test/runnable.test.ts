import { describe, it, expect } from "vitest";
import { checkRunnable, runnableFeedback, tiersOf, foundationalDirective, contractDirective, missingImportDirective, missingEndpointDirective, unrunnableEntryDirective, unexposedFeatureDirective, directiveFor, findStubEntry, RUNNABLE_TIER, type RunnableIssue } from "../src/core/runnable";
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

  it("does not false-flag missing-env when a shared .env sits at the project root (multi-module)", () => {
    // The BookIt layout: backend in server/, one shared .env at the root that dotenv loads from cwd.
    const files: SourceFile[] = [
      { path: "server/package.json", content: JSON.stringify({ dependencies: { express: "^4", dotenv: "^16" } }) },
      { path: "server/src/app.js", content: "import 'dotenv/config'; const s=process.env.JWT_SECRET; const app=require('express')(); app.listen(process.env.PORT);" },
    ];
    // .env only at the ROOT, not server/.env
    expect(checkRunnable(files, pathsOf(files, ["server/src/app.js", ".env"])).some((i) => i.kind === "missing-env")).toBe(false);
    // but with no .env anywhere, it is still flagged
    expect(checkRunnable(files, pathsOf(files, ["server/src/app.js"])).some((i) => i.kind === "missing-env")).toBe(true);
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

describe("Phase 4 — unexposed features (build completeness, the BookIt gap)", () => {
  // The exact BookIt shape: a dynamic-import entry, provider routes wired, but user/booking repos
  // implemented and never imported by anything reachable — dead features no other gate can see.
  const bookitShape = (): SourceFile[] => [
    { path: "server/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
    { path: "server/index.js", content: "const app = (await import('./src/app.ts')).default; app.listen(process.env.PORT);" },
    { path: "server/src/app.ts", content: "import express from 'express'; import providerRoutes from './routes/provider.routes.ts'; const app = express(); app.use(providerRoutes); export default app;" },
    { path: "server/src/routes/provider.routes.ts", content: "import { ServiceRepository } from '../repositories/service.repo.ts'; const router = {}; export default router;" },
    { path: "server/src/repositories/service.repo.ts", content: "export class ServiceRepository {}" },
    { path: "server/src/repositories/booking.repo.ts", content: "export class BookingRepository {}" },
    { path: "server/src/repositories/user.repo.ts", content: "export class UserRepository {}" },
  ];

  it("flags implemented-but-never-exposed feature modules (and follows dynamic imports)", () => {
    const files = bookitShape();
    const issues = checkRunnable(files, pathsOf(files)).filter((i) => i.kind === "unexposed-feature");
    expect(issues).toHaveLength(1); // one grouped issue, not one per module
    expect(issues[0]!.message).toMatch(/booking\.repo\.ts/);
    expect(issues[0]!.message).toMatch(/user\.repo\.ts/);
    const deadList = issues[0]!.message.match(/imports (.+?)\. Those/)![1]!;
    expect(deadList).not.toContain("service.repo.ts"); // the reachable one is not in the dead list
    const d = unexposedFeatureDirective(files);
    expect(d).toMatch(/exports: BookingRepository/); // names what to expose
    expect(d).toMatch(/app\.use\(/);
    expect(d).toMatch(/app file/i); // names the file that must be edited to mount
    expect(d).toMatch(/server\/src\/app\.ts/); // the actual mount file
  });

  it("the directive tells the coder to MOUNT an existing-but-unmounted route (the BookIt stall)", () => {
    // auth.routes.ts exists and reaches auth.service, but app.ts never mounts it → the coder keeps
    // rewriting routes instead of wiring them. The directive must say: this file exists, just mount it.
    const files: SourceFile[] = [
      { path: "server/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "server/index.js", content: "const app = (await import('./src/app.ts')).default; app.listen(process.env.PORT);" },
      { path: "server/src/app.ts", content: "import express from 'express'; import providerRoutes from './routes/provider.routes.ts'; const app = express(); app.use(providerRoutes); export default app;" },
      { path: "server/src/routes/provider.routes.ts", content: "import { ServiceRepository } from '../services/service.service.ts'; const router = {}; export default router;" },
      { path: "server/src/routes/auth.routes.ts", content: "import { AuthService } from '../services/auth.service.ts'; const router = {}; export default router;" },
      { path: "server/src/services/service.service.ts", content: "export class ServiceRepository {}" },
      { path: "server/src/services/auth.service.ts", content: "export class AuthService {}" }, // dead: auth.routes exists but is unmounted
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "unexposed-feature")).toBe(true);
    const d = unexposedFeatureDirective(files);
    expect(d).toMatch(/ALREADY EXIST/);
    expect(d).toMatch(/server\/src\/routes\/auth\.routes\.ts/);
    expect(d).toMatch(/do NOT rewrite/i);
  });

  it("an e2e test that boots the server is NOT a reachability root (would mask every dead feature)", () => {
    // The masking repro: a normal e2e test imports app + both repos and calls app.listen. If tests
    // counted as roots, booking/user would look "exposed" and the check would silently no-op.
    const files = [
      ...bookitShape(),
      { path: "server/test/e2e.test.ts", content: "import app from '../src/app.ts'; import { BookingRepository } from '../src/repositories/booking.repo.ts'; import { UserRepository } from '../src/repositories/user.repo.ts'; const srv = app.listen(0);" },
    ];
    const issues = checkRunnable(files, pathsOf(files)).filter((i) => i.kind === "unexposed-feature");
    expect(issues[0]?.message).toMatch(/booking\.repo\.ts/);
    expect(issues[0]?.message).toMatch(/user\.repo\.ts/);
  });

  it("commented-out wiring is not a live edge — the dead feature is still flagged", () => {
    const files = bookitShape().map((f) =>
      f.path === "server/src/app.ts"
        ? { ...f, content: "import express from 'express'; import providerRoutes from './routes/provider.routes.ts';\n// import bookingRoutes from './routes/booking.routes.ts';\nconst app = express(); app.use(providerRoutes); export default app;" }
        : f,
    );
    files.push({ path: "server/src/routes/booking.routes.ts", content: "import { BookingRepository } from '../repositories/booking.repo.ts'; const r={}; export default r;" });
    const issues = checkRunnable(files, pathsOf(files)).filter((i) => i.kind === "unexposed-feature");
    expect(issues[0]?.message).toMatch(/booking\.repo\.ts/); // the commented import didn't rescue it
  });

  it("follows CJS require() chains, barrel index files, and explicit-extension imports precisely", () => {
    // All-CJS backend wired through a services/index.cjs barrel + `require (` with a space; one
    // service is genuinely dead. Only the dead one may be flagged.
    const files: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "server.js", content: "const express = require('express'); const svcs = require ('./services'); const app = express(); app.listen(process.env.PORT);" },
      { path: "services/index.cjs", content: "module.exports = { user: require('./user.service.js') };" },
      { path: "services/user.service.js", content: "class UserService {}\nmodule.exports = UserService;" },
      { path: "services/dead.service.js", content: "class DeadService {}\nmodule.exports = DeadService;" },
    ];
    const issues = checkRunnable(files, pathsOf(files)).filter((i) => i.kind === "unexposed-feature");
    expect(issues).toHaveLength(1);
    const deadList = issues[0]!.message.match(/imports (.+?)\. Those/)![1]!;
    expect(deadList).toContain("dead.service.js");
    expect(deadList).not.toContain("user.service.js"); // wired via the index.cjs barrel
    expect(unexposedFeatureDirective(files)).toMatch(/exports: DeadService/); // CJS exports named too
  });

  it("an explicit './x.ts' import marks the .ts reachable even when a stale .js sibling exists", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "server.ts", content: "import express from 'express'; import { UserService } from './services/user.service.ts'; const app = express(); app.listen(process.env.PORT);" },
      { path: "services/user.service.ts", content: "export class UserService {}" },
      { path: "services/user.service.js", content: "class Old {}\nmodule.exports = Old;" }, // stale leftover
      { path: "services/other.service.ts", content: "export class OtherService {}" },
    ];
    const issues = checkRunnable(files, pathsOf(files)).filter((i) => i.kind === "unexposed-feature");
    const deadList = issues[0]!.message.match(/imports (.+?)\. Those/)![1]!;
    expect(deadList).not.toContain("user.service.ts"); // the file the entry literally names is reachable
  });

  it("a service wired only to a worker/seed script entry is real usage, not dead code", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ dependencies: { express: "^4" }, scripts: { start: "node server.js", worker: "node worker.js" } }) },
      { path: "server.js", content: "const express=require('express');const {UserService}=require('./services/user.service.js');const app=express();app.listen(process.env.PORT);" },
      { path: "worker.js", content: "const { QueueService } = require('./services/queue.service.js'); QueueService.run();" },
      { path: "services/user.service.js", content: "exports.UserService = class {};" },
      { path: "services/queue.service.js", content: "exports.QueueService = class {};" },
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "unexposed-feature")).toBe(false);
  });

  it("path-alias imports make the unit inconclusive (invisible edges must not condemn features)", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      // routes are imported via a tsconfig alias the resolver can't follow — plus one relative import
      { path: "server.ts", content: "import express from 'express'; import routes from '@/routes/index.ts'; import { db } from './db.ts'; const app=express(); app.use(routes); app.listen(process.env.PORT);" },
      { path: "db.ts", content: "export const db = {};" },
      { path: "routes/index.ts", content: "import { UserService } from '../services/user.service.ts'; export default {};" },
      { path: "services/user.service.ts", content: "export class UserService {}" },
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "unexposed-feature")).toBe(false);
  });

  it("a package-less static frontend (public/) is never judged by backend feature rules", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "server.js", content: "const express=require('express');const {Core}=require('./services/core.service.js');const app=express();app.use(express.static('public'));app.listen(process.env.PORT);" },
      { path: "services/core.service.js", content: "exports.Core = class {};" },
      // browser code, served over HTTP — no package.json of its own, and never imported by the server
      { path: "public/services/api.service.js", content: "const api = { get: (u) => fetch(u) };" },
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "unexposed-feature")).toBe(false);
  });

  it("a .d.ts declaration file is neither a missing import nor a feature candidate", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "server.ts", content: "import express from 'express'; import type { Cfg } from './services/types'; import { UserService } from './services/user.service.ts'; const app=express(); app.listen(process.env.PORT);" },
      { path: "services/types.d.ts", content: "export interface Cfg { port: number }" },
      { path: "services/user.service.ts", content: "export class UserService {}" },
    ];
    const issues = checkRunnable(files, pathsOf(files));
    expect(issues.some((i) => i.kind === "missing-import")).toBe(false); // ./services/types resolves to the .d.ts
    expect(issues.some((i) => i.kind === "unexposed-feature")).toBe(false); // types.d.ts is not a feature
  });

  it("a single dead feature in a demonstrably-working graph IS flagged (no blanket zero-guard)", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "server.js", content: "const app = require('./app.js'); app.listen(process.env.PORT);" }, // graph resolves
      { path: "app.js", content: "const express = require('express'); module.exports = express();" },
      { path: "services/booking.service.js", content: "exports.BookingService = class {};" }, // the unit's only feature — dead
    ];
    const issues = checkRunnable(files, pathsOf(files)).filter((i) => i.kind === "unexposed-feature");
    expect(issues[0]?.message).toMatch(/booking\.service\.js/);
  });

  it("the directive cross-references paths the frontend already calls for the dead feature", () => {
    const files: SourceFile[] = [
      ...bookitShape(),
      { path: "client/package.json", content: JSON.stringify({ dependencies: { react: "^18", axios: "^1" } }) },
      { path: "client/src/api.js", content: "import axios from 'axios'; const api = axios.create({ baseURL: '/' }); api.post('/api/bookings', {});" },
    ];
    // give the backend a matching endpoint so the contract analysis has a working base to compare against
    const withRoute = files.map((f) => (f.path === "server/src/routes/provider.routes.ts" ? { ...f, content: "import { ServiceRepository } from '../repositories/service.repo.ts'; const router = require('express').Router(); router.get('/api/services', h); module.exports = router;" } : f));
    const d = unexposedFeatureDirective(withRoute);
    expect(d).toMatch(/booking\.repo\.ts/);
  });

  it("does not flag when every feature module is reachable from the entry", () => {
    const files = bookitShape().filter((f) => !/booking\.repo|user\.repo/.test(f.path));
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "unexposed-feature")).toBe(false);
  });

  it("suppresses flags when the import graph is inconclusive (zero reachable features)", () => {
    // Entry imports the app via a path alias the resolver can't follow — nothing in the feature layer
    // is reachable. That means the GRAPH is broken, not that every feature is dead: don't flag.
    const files: SourceFile[] = [
      { path: "server/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "server/index.js", content: "const app = (await import('#app')).default; app.listen(process.env.PORT);" },
      { path: "server/src/repositories/user.repo.ts", content: "export class UserRepository {}" },
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "unexposed-feature")).toBe(false);
  });

  it("never judges a frontend's services/ directory by backend rules (nested unit ownership)", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "server.js", content: "const e=require('express');const app=e();const r=require('./services/core.service.js');app.use(r);app.listen(process.env.PORT);" },
      { path: "services/core.service.js", content: "module.exports = {};" },
      // the client owns its own package.json — its services dir belongs to IT, not the backend unit
      { path: "client/package.json", content: JSON.stringify({ dependencies: { react: "^18" } }) },
      { path: "client/src/services/api.service.ts", content: "export const api = {};" },
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "unexposed-feature")).toBe(false);
  });

  it("a module imported only by tests is still dead (tests are not the API)", () => {
    const files = [...bookitShape(), { path: "server/test/booking.test.ts", content: "import { BookingRepository } from '../src/repositories/booking.repo.ts';" }];
    const issues = checkRunnable(files, pathsOf(files)).filter((i) => i.kind === "unexposed-feature");
    expect(issues[0]?.message).toMatch(/booking\.repo\.ts/);
  });

  it("skips entirely when there is no server entry (the no-entry check owns that)", () => {
    const files = bookitShape().filter((f) => f.path !== "server/index.js");
    const issues = checkRunnable(files, pathsOf(files));
    expect(issues.some((i) => i.kind === "unexposed-feature")).toBe(false);
    expect(issues.some((i) => i.kind === "no-entry")).toBe(true);
  });

  it("sits in tier 2 and directiveFor picks the expose directive", () => {
    const files = bookitShape();
    expect(RUNNABLE_TIER["unexposed-feature"]).toBe(2);
    const issue: RunnableIssue = { kind: "unexposed-feature", where: "server", message: "m" };
    const { text, note } = directiveFor([issue], [issue], files);
    expect(note).toMatch(/expose the implemented features/i);
    expect(text).toMatch(/dead code/i);
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

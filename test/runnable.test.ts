import { describe, it, expect } from "vitest";
import { checkRunnable, runnableFeedback, tiersOf, foundationalDirective, contractDirective, missingImportDirective, missingEndpointDirective, unrunnableEntryDirective, unexposedFeatureDirective, missingDependencyDirective, planWireUp, scaffoldRoutes, directiveFor, findStubEntry, RUNNABLE_TIER, type RunnableIssue } from "../src/core/runnable";
import type { SourceFile as SF } from "../src/core/contract";

/** Apply planWireUp edits back onto a file set (what the repair loop does on disk). */
function applyWireUp(files: SF[]): SF[] {
  const edits = planWireUp(files, new Set(files.map((f) => f.path.replace(/\\/g, "/"))));
  const map = new Map(edits.map((e) => [e.path.replace(/\\/g, "/"), e.content]));
  return files.map((f) => (map.has(f.path.replace(/\\/g, "/")) ? { ...f, content: map.get(f.path.replace(/\\/g, "/"))! } : f));
}
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
      { path: "server/src/routes/provider.routes.ts", content: "import { Router } from 'express'; import { ServiceRepository } from '../services/service.service.ts'; const router = Router(); router.get('/x',(q,r)=>{}); export default router;" },
      { path: "server/src/routes/auth.routes.ts", content: "import { Router } from 'express'; import { AuthService } from '../services/auth.service.ts'; const router = Router(); router.post('/login',(q,r)=>{}); export default router;" },
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

  it("an all-dead feature layer in a demonstrably-working graph IS flagged (no blanket zero-guard)", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "server.js", content: "const app = require('./app.js'); app.listen(process.env.PORT);" }, // graph resolves
      { path: "app.js", content: "const express = require('express'); module.exports = express();" },
      { path: "services/booking.service.js", content: "exports.BookingService = class {};" }, // dead
      { path: "services/user.service.js", content: "exports.UserService = class {};" }, // also dead — zero reachable
    ];
    const issues = checkRunnable(files, pathsOf(files)).filter((i) => i.kind === "unexposed-feature");
    expect(issues[0]?.message).toMatch(/booking\.service\.js/);
    expect(issues[0]?.message).toMatch(/user\.service\.js/);
  });

  it("suppresses when routes are loaded DYNAMICALLY (readdir + import) — the static graph is blind", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "server.js", content: "const app = require('./app.js'); app.listen(process.env.PORT);" },
      // app auto-loads every router in routes/ at runtime — the walker can't follow that edge
      { path: "app.js", content: "const express=require('express');const fs=require('fs');const app=express();for(const f of fs.readdirSync('./routes')) app.use(require('./routes/'+f));module.exports=app;" },
      { path: "services/order.service.js", content: "exports.OrderService = class {};" },
      { path: "routes/order.routes.js", content: "const r=require('express').Router();module.exports=r;" },
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "unexposed-feature")).toBe(false);
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

describe("Phase 4 — missing npm dependency (imported but not in package.json)", () => {
  const mkPkg = (deps: Record<string, string> = {}, extra: object = {}) => JSON.stringify({ dependencies: deps, ...extra });

  it("flags a package imported but declared in no package.json (the OpsHub ws/jwt boot crash)", () => {
    const files: SourceFile[] = [
      { path: "backend/package.json", content: mkPkg({ express: "^4" }) }, // jsonwebtoken + ws NOT declared
      { path: "backend/src/index.ts", content: "import express from 'express'; import jwt from 'jsonwebtoken'; import { WebSocketServer } from 'ws'; const app = express(); app.listen(process.env.PORT);" },
    ];
    const md = checkRunnable(files, pathsOf(files)).find((i) => i.kind === "missing-dependency");
    expect(md?.message).toMatch(/jsonwebtoken/);
    expect(md?.message).toMatch(/\bws\b/);
    expect(md?.message).not.toMatch(/express/); // declared → not flagged
    expect(missingDependencyDirective(files, pathsOf(files))).toMatch(/do NOT remove the imports/i);
  });

  it("does NOT flag Node builtins (bare or node:), including node:sqlite", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: mkPkg({ express: "^4" }) },
      { path: "server.js", content: "import fs from 'fs'; import path from 'node:path'; import { DatabaseSync } from 'node:sqlite'; import { readFile } from 'fs/promises'; import express from 'express'; const app=express(); app.listen(process.env.PORT);" },
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "missing-dependency")).toBe(false);
  });

  it("does NOT flag tsconfig path aliases (@/…), ~/…, or #imports", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: mkPkg({ express: "^4" }) },
      { path: "tsconfig.json", content: '{ "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/*"], "@config": ["src/config.ts"] } } } // trailing comment' },
      { path: "src/index.ts", content: "import express from 'express'; import { x } from '@app/util'; import cfg from '@config'; import y from '~/lib/y'; import z from '#internal/z'; const app=express(); app.listen(process.env.PORT);" },
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "missing-dependency")).toBe(false);
  });

  it("does NOT flag a bare specifier that resolves to a local file (baseUrl), or a workspace/self name", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: mkPkg({ express: "^4" }, { name: "myapp", workspaces: ["pkgs/*"] }) },
      { path: "pkgs/shared/package.json", content: mkPkg({}, { name: "@myapp/shared" }) },
      { path: "src/index.ts", content: "import express from 'express'; import { helper } from 'utils/helper'; import { s } from '@myapp/shared'; const app=express(); app.listen(process.env.PORT);" },
      { path: "src/utils/helper.ts", content: "export const helper = 1;" }, // 'utils/helper' resolves here via baseUrl
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "missing-dependency")).toBe(false);
  });

  it("is lenient across a monorepo — a package declared at the ROOT is fine for a workspace", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: mkPkg({ zod: "^3" }, { workspaces: ["backend"] }) }, // zod at root
      { path: "backend/package.json", content: mkPkg({ express: "^4" }) }, // backend doesn't redeclare zod
      { path: "backend/src/index.ts", content: "import express from 'express'; import { z } from 'zod'; const app=express(); app.listen(process.env.PORT);" },
    ];
    expect(checkRunnable(files, pathsOf(files)).some((i) => i.kind === "missing-dependency")).toBe(false);
  });

  it("does NOT flag a type-only import, and maps a scoped subpath to its package", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: mkPkg({ express: "^4", "@scope/ui": "^1" }) },
      { path: "src/index.ts", content: "import express from 'express'; import type { Foo } from 'some-types-only-pkg'; import { Button } from '@scope/ui/button'; const app=express(); app.listen(process.env.PORT);" },
    ];
    const md = checkRunnable(files, pathsOf(files)).filter((i) => i.kind === "missing-dependency");
    expect(md).toHaveLength(0); // type-only import ignored; @scope/ui/button → @scope/ui (declared)
  });

  it("routes through directiveFor at tier 1", () => {
    expect(RUNNABLE_TIER["missing-dependency"]).toBe(1);
    const issue: RunnableIssue = { kind: "missing-dependency", where: ".", message: "m" };
    expect(directiveFor([issue], [issue], [{ path: "package.json", content: "{}" }]).note).toMatch(/declare the imported packages/i);
  });
});

describe("Phase 4 — deterministic wire-up (mount routers without a model)", () => {
  const app = (imports: string, mounts: string) =>
    `import express from 'express';\n${imports}import { errorHandler } from './middleware/error.ts';\nconst app = express();\napp.use(express.json());\n${mounts}app.use((req, res) => res.status(404).json({ message: 'Not Found' }));\napp.use(errorHandler);\nexport default app;`;

  const base = (): SourceFile[] => [
    { path: "server/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
    { path: "server/index.js", content: "const app = (await import('./src/app.ts')).default; app.listen(process.env.PORT);" },
    { path: "server/src/app.ts", content: app("import providerRoutes from './routes/provider.routes.ts';\n", "app.use(providerRoutes);\n") },
    { path: "server/src/routes/provider.routes.ts", content: "import { Router } from 'express'; const router = Router(); router.get('/services', (_q,r)=>r.json([])); export default router;" },
    { path: "server/src/routes/auth.routes.ts", content: "import { Router } from 'express'; import { AuthService } from '../services/auth.service.ts'; const router = Router(); router.post('/auth/login', (_q,r)=>r.json({})); export default router;" },
    { path: "server/src/services/auth.service.ts", content: "export class AuthService {}" },
  ];

  it("mounts an existing-but-unmounted router: adds the import and app.use, mirroring style", () => {
    const files = base();
    const edits = planWireUp(files, pathsOf(files));
    expect(edits).toHaveLength(1);
    expect(edits[0]!.path).toMatch(/app\.ts$/);
    expect(edits[0]!.mounted.map((m) => m.varName)).toEqual(["authRoutes"]);
    const c = edits[0]!.content;
    expect(c).toMatch(/import authRoutes from '\.\/routes\/auth\.routes\.ts';/); // app writes .ts specifiers → mirror .ts
    expect(c).toMatch(/app\.use\(authRoutes\);/); // bare mount, matching the existing app.use(providerRoutes)
    // ordering: the new import sits in the import block; the mount is BEFORE the 404 handler
    expect(c.indexOf("app.use(authRoutes)")).toBeLessThan(c.indexOf("res.status(404)"));
    expect(c.indexOf("app.use(authRoutes)")).toBeGreaterThan(c.indexOf("app.use(express.json())"));
    expect(c.indexOf("import authRoutes")).toBeLessThan(c.indexOf("const app = express()"));
  });

  it("wiring up clears both unmounted-routes AND the downstream dead feature — with no model call", () => {
    const before = checkRunnable(base(), pathsOf(base()));
    expect(before.some((i) => i.kind === "unmounted-routes")).toBe(true);
    expect(before.some((i) => i.kind === "unexposed-feature")).toBe(true); // auth.service dead (auth.routes unmounted)
    const after = applyWireUp(base());
    const issues = checkRunnable(after, pathsOf(after));
    expect(issues.some((i) => i.kind === "unmounted-routes")).toBe(false);
    expect(issues.some((i) => i.kind === "unexposed-feature")).toBe(false);
  });

  it("does NOT touch a router already reachable via a mounted barrel/index (no double mount)", () => {
    const files: SourceFile[] = [
      { path: "server/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "server/index.js", content: "const app = (await import('./src/app.ts')).default; app.listen(process.env.PORT);" },
      { path: "server/src/app.ts", content: app("import routes from './routes/index.ts';\n", "app.use(routes);\n") },
      { path: "server/src/routes/index.ts", content: "import { Router } from 'express'; import auth from './auth.routes.ts'; const router = Router(); router.use(auth); export default router;" },
      { path: "server/src/routes/auth.routes.ts", content: "import { Router } from 'express'; const router = Router(); export default router;" },
    ];
    expect(planWireUp(files, pathsOf(files))).toHaveLength(0); // auth is reachable via the mounted index
  });

  it("mirrors a prefixed mount style and dedups variable-name collisions", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "server.js", content: "const express=require('express');const authRoutes=1;const app=express();app.use('/api/users', require('./routes/users.js'));app.use((req,res)=>res.sendStatus(404));app.listen(process.env.PORT);" },
      { path: "routes/users.js", content: "const r=require('express').Router();module.exports=r;" },
      { path: "routes/auth.js", content: "const r=require('express').Router();r.post('/x',()=>{});module.exports=r;" },
    ];
    const edits = planWireUp(files, pathsOf(files));
    const c = edits[0]!.content;
    expect(c).toMatch(/app\.use\('\/api\/auth', authRoutes2\)/); // prefixed style mirrored; name deduped (authRoutes taken)
    expect(c.indexOf("app.use('/api/auth'")).toBeLessThan(c.indexOf("res.sendStatus(404)")); // before the 404
  });

  it("returns nothing when there is nothing to mount (all routers already wired)", () => {
    const files = base().filter((f) => !/auth/.test(f.path)); // only provider, already mounted
    expect(planWireUp(files, pathsOf(files))).toHaveLength(0);
  });

  it("detects + mounts a MODULAR router (modules/<feature>/routes.ts, no routes/ dir) — the OpsHub gap", () => {
    // The OpsHub structure: routers live at modules/task/routes.ts with a generic `routes` basename.
    // A path-based rule misses them; detection must be by content, and the var name from the folder.
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "backend/src/index.ts", content: "import express from 'express';\nconst app = express();\napp.use((req,res)=>res.sendStatus(404));\napp.listen(process.env.PORT);" },
      { path: "backend/src/modules/task/routes.ts", content: "import { Router } from 'express'; const router = Router(); router.get('/', (q,r)=>{}); export default router;" },
    ];
    const edits = planWireUp(files, pathsOf(files));
    expect(edits[0]!.mounted.map((m) => m.varName)).toEqual(["taskRoutes"]); // folder name, not "routesRoutes"
    expect(edits[0]!.content).toMatch(/import taskRoutes from '\.\/modules\/task\/routes(\.js)?'/); // ext mirrored elsewhere
    expect(edits[0]!.content).toMatch(/app\.use\(taskRoutes\)/);
  });

  it("does NOT falsely flag a modular router mounted from an index.ts entry (the resolveTail /index bug)", () => {
    // index.ts strips to its parent via moduleKey; a router it mounts must still resolve correctly.
    const files: SourceFile[] = [
      { path: "backend/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "backend/src/index.ts", content: "import express from 'express';\nimport authRoutes from './modules/auth/routes.js';\nconst app = express();\napp.use('/auth', authRoutes);\napp.listen(process.env.PORT);" },
      { path: "backend/src/modules/auth/routes.ts", content: "import { Router } from 'express'; import { AuthService } from './service.js'; const router = Router(); router.post('/login',(q,r)=>{}); export default router;" },
      { path: "backend/src/modules/auth/service.ts", content: "export class AuthService {}" },
    ];
    const issues = checkRunnable(files, pathsOf(files));
    expect(issues.some((i) => i.kind === "unmounted-routes")).toBe(false); // was flagged: index.ts entry mis-resolved
    expect(issues.some((i) => i.kind === "unexposed-feature")).toBe(false); // auth.service reachable via the mounted router
  });

  it("mirrors a .js-specifier / .ts-file convention (import written as .js — survives tsc)", () => {
    // The standard TS-ESM pattern: the app imports './routes/x.js' but the file is x.ts.
    const files: SourceFile[] = [
      { path: "server/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
      { path: "server/index.js", content: "const app = (await import('./src/app.ts')).default; app.listen(process.env.PORT);" },
      { path: "server/src/app.ts", content: "import express from 'express';\nimport providerRoutes from './routes/provider.routes.js';\nconst app = express();\napp.use(providerRoutes);\napp.use((req,res)=>res.sendStatus(404));\nexport default app;" },
      { path: "server/src/routes/provider.routes.ts", content: "import { Router } from 'express'; const router = Router(); export default router;" },
      { path: "server/src/routes/auth.routes.ts", content: "import { Router } from 'express'; const router = Router(); export default router;" },
    ];
    const c = planWireUp(files, pathsOf(files))[0]!.content;
    expect(c).toMatch(/import authRoutes from '\.\/routes\/auth\.routes\.js';/); // .js specifier, not the file's real .ts
  });
});

describe("Phase 4 — scaffold missing route files (deterministic generation)", () => {
  // BookIt's remaining gap: services with NO route file at all. Static + instance methods, a repo
  // imported transitively by a service (must NOT get its own route).
  const noRouteShape = (): SourceFile[] => [
    { path: "server/package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
    { path: "server/index.js", content: "const app = (await import('./src/app.ts')).default; app.listen(process.env.PORT);" },
    { path: "server/src/app.ts", content: "import express from 'express'; import providerRoutes from './routes/provider.routes.js'; const app = express(); app.use(providerRoutes); app.use((req,res)=>res.sendStatus(404)); export default app;" },
    { path: "server/src/routes/provider.routes.ts", content: "import { Router } from 'express'; const router = Router(); export default router;" },
    { path: "server/src/services/booking.service.ts", content: "import { BookingRepository } from '../repositories/booking.repo.js';\nexport class BookingService {\n  static async bookSlot(customerId, serviceId, start) { return {}; }\n  static async cancelBooking(id) { return {}; }\n  static async getCustomerBookings(customerId) { return []; }\n}" },
    { path: "server/src/repositories/booking.repo.ts", content: "export class BookingRepository { static create(b) {} static findById(id) {} }" },
    { path: "server/src/services/auth.service.ts", content: "export class AuthService {\n  async register(email, password) { return {}; }\n  async login(email, password) { return {}; }\n}" },
  ];

  it("scaffolds a router only for top-level dead services (repo exposed transitively)", () => {
    const edits = scaffoldRoutes(noRouteShape(), pathsOf(noRouteShape()));
    const modules = edits.map((e) => e.module.replace(/\\/g, "/")).sort();
    expect(modules).toEqual(["server/src/services/auth.service.ts", "server/src/services/booking.service.ts"]);
    expect(edits.some((e) => /booking\.repo/.test(e.module))).toBe(false); // transitively exposed, no own route
    expect(edits.every((e) => /\/routes\/\w+\.routes\.ts$/.test(e.path.replace(/\\/g, "/")))).toBe(true); // placed in routes/, .ts
  });

  it("the scaffolded router imports the module and maps methods to sensible REST endpoints", () => {
    const booking = scaffoldRoutes(noRouteShape(), pathsOf(noRouteShape())).find((e) => /booking/.test(e.module))!;
    const c = booking.content;
    expect(c).toMatch(/import \{ BookingService \} from '\.\.\/services\/booking\.service\.js'/); // .js specifier learned from the graph
    expect(c).toMatch(/router\.post\('\/', async/); // bookSlot → POST /
    expect(c).toMatch(/router\.delete\('\/:id', async/); // cancelBooking → DELETE /:id
    expect(c).toMatch(/router\.get\('\/', async/); // getCustomerBookings (plural) → GET /
    expect(c).toMatch(/await BookingService\.bookSlot\(req\.body\.customerId, req\.body\.serviceId, req\.body\.start\)/); // static call, args by name
    expect(c).toMatch(/export default router/);
  });

  it("instance methods get a `new` controller; DELETE ends with 204", () => {
    const auth = scaffoldRoutes(noRouteShape(), pathsOf(noRouteShape())).find((e) => /auth/.test(e.module))!;
    expect(auth.content).toMatch(/const controller = new AuthService\(\);/);
    expect(auth.content).toMatch(/await controller\.register\(req\.body\.email, req\.body\.password\)/);
    const booking = scaffoldRoutes(noRouteShape(), pathsOf(noRouteShape())).find((e) => /booking/.test(e.module))!;
    expect(booking.content).toMatch(/res\.status\(204\)\.end\(\);/); // cancelBooking
  });

  it("scaffold + wire-up together take a no-route project to 0 issues", () => {
    let files = noRouteShape();
    // 1. scaffold missing routers
    for (const e of scaffoldRoutes(files, pathsOf(files))) files = [...files, { path: e.path, content: e.content }];
    // 2. wire them up
    const edits = planWireUp(files, new Set(files.map((f) => f.path.replace(/\\/g, "/"))));
    const map = new Map(edits.map((e) => [e.path.replace(/\\/g, "/"), e.content]));
    files = files.map((f) => (map.has(f.path.replace(/\\/g, "/")) ? { ...f, content: map.get(f.path.replace(/\\/g, "/"))! } : f));
    const issues = checkRunnable(files, pathsOf(files));
    expect(issues.some((i) => i.kind === "unexposed-feature")).toBe(false);
    expect(issues.some((i) => i.kind === "unmounted-routes")).toBe(false);
  });

  it("does not scaffold when a route file already imports the dead module (wire-up handles it)", () => {
    const files = [
      ...noRouteShape().filter((f) => !/auth\.service|booking/.test(f.path)),
      { path: "server/src/services/notify.service.ts", content: "export class NotifyService { send(x) {} }" },
      { path: "server/src/routes/notify.routes.ts", content: "import { NotifyService } from '../services/notify.service.js'; import { Router } from 'express'; const router = Router(); export default router;" },
    ];
    // notify.service IS imported by an (unmounted) route file → scaffolding must not duplicate it
    expect(scaffoldRoutes(files, pathsOf(files)).some((e) => /notify/.test(e.module))).toBe(false);
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

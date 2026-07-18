/**
 * Dynamic boot gate (Phase 4 · fullstack frontier — "builds" → "runs").
 *
 * Static checks (runnable.ts) confirm a project is *structurally* runnable — entry point, routes
 * mounted, imports resolve, env present. They CANNOT catch a crash that only happens when Node
 * actually loads and runs the code: the fullstack build passed every static check but its backend
 * died on boot because one route file used CommonJS `module.exports` in an ESM (`"type":"module"`)
 * project. This gate actually **boots the assembled server** on an injected port and drives a couple
 * of endpoints — catching boot crashes and 5xx handler errors that static analysis can't.
 *
 * The detection/selection/classification logic is pure + unit-tested; the boot itself is inherently
 * integration-level and best-effort (never blocks on inconclusive results).
 */

import net from "node:net";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { extractContract, type ProjectContract, type SourceFile } from "./contract.js";

export interface SmokeIssue {
  kind: "boot-failed" | "server-error";
  message: string;
}

const norm = (p: string): string => p.replace(/\\/g, "/");
const dirOf = (p: string): string => norm(p).split("/").slice(0, -1).join("/");
const moduleKey = (p: string): string => norm(p).replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
const isCode = (p: string): boolean => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p);

/** Find the primary server unit and its bootable entry file (the one that calls `.listen()`). */
export function detectServerEntry(files: SourceFile[]): { dir: string; entry: string } | null {
  for (const pkg of files.filter((f) => norm(f.path).endsWith("package.json"))) {
    const dir = dirOf(pkg.path);
    const prefix = dir ? dir + "/" : "";
    let json: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
    try {
      json = JSON.parse(pkg.content);
    } catch {
      continue;
    }
    const deps = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) };
    if (!["express", "fastify", "koa", "@hapi/hapi", "@nestjs/core", "http"].some((d) => d in deps)) continue;
    const servers = files.filter((f) => norm(f.path).startsWith(prefix) && isCode(f.path) && /\.listen\s*\(/.test(f.content));
    if (servers.length === 0) continue;
    // Prefer a start-script target, else a conventionally-named server file, else the first.
    const start = json.scripts?.start ?? json.scripts?.dev;
    const startTarget = typeof start === "string" ? start.match(/\b(?:node|nodemon|ts-node|tsx)\s+(?:--\S+\s+)*([^\s&|;]+)/)?.[1]?.replace(/^\.\//, "") : undefined;
    const byStart = startTarget ? servers.find((f) => moduleKey(f.path) === moduleKey(prefix + startTarget)) : undefined;
    const preferred = byStart ?? servers.find((f) => /\/(server|app|index|main)\.(js|ts|mjs|cjs)$/i.test("/" + norm(f.path))) ?? servers[0]!;
    return { dir, entry: norm(preferred.path).slice(prefix.length) };
  }
  return null;
}

export interface Probe {
  method: string;
  path: string;
  body?: unknown;
}

/**
 * How to actually launch the server. A TypeScript entry cannot be run with plain `node app.ts` — it
 * must go through its loader — so respect the unit's own start/dev script (tsx / ts-node / node) and
 * fall back to inferring the runner from the entry's extension. Without this the boot gate spuriously
 * fails EVERY TypeScript backend even when its start script is correctly configured for tsx.
 */
export interface BootLaunch {
  runner: "node" | "tsx" | "ts-node";
  entry: string;
}

export function bootLaunch(files: SourceFile[], server: { dir: string; entry: string }): BootLaunch {
  const prefix = server.dir ? server.dir + "/" : "";
  const pkg = files.find((f) => norm(f.path) === prefix + "package.json");
  let script: string | undefined;
  if (pkg) {
    try {
      const scripts = (JSON.parse(pkg.content) as { scripts?: Record<string, string> }).scripts ?? {};
      script = scripts.start ?? scripts.dev;
    } catch {
      /* malformed — infer below */
    }
  }
  let runner: BootLaunch["runner"] | "" = "";
  let entry = server.entry;
  const m = script?.match(/\b(tsx|ts-node|nodemon|node)\s+(?:--\S+\s+)*([^\s&|;]+)/);
  if (m) {
    runner = m[1] === "nodemon" ? "node" : (m[1] as BootLaunch["runner"]); // nodemon just wraps node — boot the runner directly
    entry = m[2]!.replace(/^\.\//, "");
    if (/\bts-node\b/.test(script!) || /--loader\s+ts-node|--import\s+tsx/.test(script!)) runner = /ts-node/.test(script!) ? "ts-node" : "tsx";
  }
  if (!runner) runner = /\.tsx?$/.test(entry) ? "tsx" : "node"; // no script → infer from the entry
  // A plain-node runner on a TypeScript entry can't work — force a loader so the app actually boots.
  if (runner === "node" && /\.tsx?$/.test(entry)) runner = "tsx";
  return { runner, entry };
}

/**
 * Turn an endpoint string ("POST /api/auth/login") path into a probeable path (params → 1).
 * extractContract may append a human-readable note ("GET /  (defined in src/routes/x)"); keep only the
 * first whitespace-delimited token, or the note's spaces/parens land in the URL and http.request throws
 * "Request path contains unescaped characters" — which once killed an entire 89-minute build.
 */
const toProbePath = (p: string): string =>
  "/" +
  (p.trim().split(/\s+/)[0] ?? "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+/, "")
    .replace(/\/(?::\w+|\$\{[^}]+\}|\d+)(?=\/|$)/g, "/1")
    .replace(/\/+$/, "");

/**
 * Pick a small set of endpoints to hit: the base, and the first register/create POST. `nonce` makes
 * the payload unique so a persisted DB can't mask a 500 behind an "already exists" 400 on retry — a
 * register that 500s the first time (after inserting the row) would otherwise 400 the second time.
 */
export function pickProbes(contract: ProjectContract, nonce = "smoketest"): Probe[] {
  const probes: Probe[] = [{ method: "GET", path: "/" }]; // a crash/500 here is telling; 404 is fine
  // Every GET the contract declares — reads have no side effects, so probing the whole read surface
  // catches a 5xx anywhere in it (a handler that throws on a clean request), not just at the root.
  const seen = new Set<string>(["GET /"]);
  for (const e of contract.endpoints.filter((x) => /^GET\s/i.test(x))) {
    const path = toProbePath(e.replace(/^\w+\s+/, ""));
    const key = `GET ${path}`;
    if (path && !seen.has(key) && seen.size <= 10) {
      seen.add(key);
      probes.push({ method: "GET", path });
    }
  }
  // The first register/create POST, with a generic body (a 5xx here is the classic broken-signup bug).
  const reg = contract.endpoints.find((e) => /^POST\s+\S*(register|signup|users?)\b/i.test(e)) ?? contract.endpoints.find((e) => /^POST\s/.test(e));
  if (reg) probes.push({ method: "POST", path: toProbePath(reg.replace(/^\w+\s+/, "")), body: { username: `sm_${nonce}`, email: `sm_${nonce}@test.dev`, password: "smoketest12345", name: `Smoke ${nonce}`, title: `t_${nonce}`, content: "c" } });
  return probes;
}

/** Only a 5xx is a server bug; a 4xx (validation/auth) or an unreachable path is fine. */
export function classifyProbes(results: { probe: Probe; status?: number; error?: string }[]): SmokeIssue[] {
  const issues: SmokeIssue[] = [];
  for (const r of results) {
    if (r.error) continue; // couldn't reach that exact path — the server is up, don't over-flag
    if (r.status != null && r.status >= 500) {
      issues.push({
        kind: "server-error",
        message: `${r.probe.method} ${r.probe.path} returned HTTP ${r.status} — the endpoint throws at runtime (a 5xx is a server bug, not a client error). Fix the handler so a valid request returns 2xx and a bad one returns 4xx, without crashing.`,
      });
    }
  }
  return issues;
}

const freePort = (): Promise<number> =>
  new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => res(p));
    });
  });

function killTree(child: ReturnType<typeof spawn>): void {
  if (child.pid == null) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function waitForPort(port: number, timeoutMs: number, crashed: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = (): void => {
      if (crashed()) return resolve(false);
      if (Date.now() > deadline) return resolve(false);
      const sock = net.connect(port, "127.0.0.1");
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => {
        sock.destroy();
        setTimeout(tick, 150);
      });
    };
    tick();
  });
}

function httpProbe(port: number, probe: Probe): Promise<{ probe: Probe; status?: number; error?: string }> {
  return new Promise((resolve) => {
    // http.request throws SYNCHRONOUSLY on a malformed path/header. This gate is diagnostic — it must
    // never be able to crash the build it is inspecting, so nothing here may escape as an exception.
    try {
      const body = probe.body != null ? JSON.stringify(probe.body) : undefined;
      const req = http.request(
        { host: "127.0.0.1", port, path: probe.path, method: probe.method, timeout: 5000, headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {} },
        (res) => {
          res.resume();
          resolve({ probe, status: res.statusCode });
        },
      );
      req.on("error", (e) => resolve({ probe, error: e.message }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ probe, error: "timeout" });
      });
      if (body) req.write(body);
      req.end();
    } catch (e) {
      resolve({ probe, error: e instanceof Error ? e.message : String(e) }); // unreachable path → inconclusive, not fatal
    }
  });
}

const firstError = (stderr: string): string => {
  const lines = stderr.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines.find((l) => /(Error|Cannot|is not|Unexpected|SyntaxError|MODULE_NOT_FOUND|ERR_|throw)/.test(l)) ?? lines[0] ?? "(no error output)").slice(0, 300);
};

/**
 * Actually boot the server on an injected port and probe a couple of endpoints. Returns boot-failed
 * (crashed on startup) or server-error (5xx) issues. Best-effort: if the server neither binds nor
 * crashes (e.g. it needs a build step or deps aren't installed), returns [] rather than blocking.
 */
export async function bootAndProbe(cwd: string, entry: string, contract: ProjectContract, opts: { timeoutMs?: number; launch?: BootLaunch } = {}): Promise<SmokeIssue[]> {
  const port = await freePort();
  const launch = opts.launch ?? { runner: "node", entry };
  // Resolve the runner: node → this Node; tsx/ts-node → the unit-local bin installed beside the app
  // (deps were installed there before boot), so a TypeScript app boots through its loader. On Windows
  // the local bin is a .cmd, which spawn can only run through a shell.
  let command = process.execPath;
  let args = [launch.entry];
  let useShell = false;
  if (launch.runner !== "node") {
    const binName = process.platform === "win32" ? `${launch.runner}.cmd` : launch.runner;
    const localBin = join(cwd, "node_modules", ".bin", binName);
    if (existsSync(localBin)) {
      command = localBin;
      args = [launch.entry];
      useShell = process.platform === "win32";
    } else {
      // No local loader binary — best effort via node's built-in TS support won't cover tsx; fall back
      // to plain node (the static unrunnable-entry check should have prevented reaching here for .ts).
      command = process.execPath;
      args = [launch.entry];
    }
  }
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, PORT: String(port), NODE_ENV: "development" },
    stdio: ["ignore", "ignore", "pipe"],
    detached: process.platform !== "win32",
    shell: useShell,
  });
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => {
    if (stderr.length < 4000) stderr += d.toString();
  });
  let exitCode: number | null = null;
  child.on("exit", (c) => (exitCode = c ?? 0));
  child.on("error", () => (exitCode = -1));
  try {
    const up = await waitForPort(port, opts.timeoutMs ?? 9000, () => exitCode !== null);
    if (!up) {
      if (exitCode != null && exitCode !== 0) {
        return [{ kind: "boot-failed", message: `the backend crashed on startup (\`${launch.runner} ${launch.entry}\` exited ${exitCode}):\n  ${firstError(stderr)}\nFix this so the server starts and listens on process.env.PORT.` }];
      }
      return []; // never bound but didn't crash — inconclusive (build step / deps?); don't block
    }
    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); // unique per boot (no stale-DB masking)
    const results = [];
    for (const p of pickProbes(contract, nonce)) results.push(await httpProbe(port, p));
    return classifyProbes(results);
  } finally {
    killTree(child);
  }
}

export interface DepInstall {
  installed: boolean;
  reason?: string;
  dir?: string;
  /**
   * Why it failed. "resolution" (a version that cannot be resolved) and "native-build" (a stale native
   * module with no prebuild for this Node) are code bugs the coder can repair in package.json. A
   * "timeout" or "other" is NOT — sending those to the ladder makes it chase a bug that isn't there.
   */
  kind?: "resolution" | "native-build" | "timeout" | "other";
  /** For native-build: the module whose native compile failed (so the repair can name it). */
  failedModule?: string;
}

/** Pull the meaningful npm error lines out of its stderr (drop boilerplate/log-path noise). */
export function npmError(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.replace(/^npm (error|ERR!)\s?/, "").trim())
    .filter((l) => l && !/^A complete log|^\s*$|node_modules\/\.package-lock|^gyp |^prebuild/i.test(l));
  return [...new Set(lines)].slice(0, 8).join("; ").slice(0, 400);
}

/** True when a Docker daemon is reachable — so an install/boot can run in a toolchain container. */
export function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Args for a one-shot `docker run` that installs deps for `hostDir` inside a full toolchain image (the
 * default node:22-bookworm carries python3/make/g++), so even a native module with NO prebuilt binary
 * compiles cleanly — the "native modules always work" guarantee, opt-in via CHORALE_BOOT_CONTAINER. Pure
 * (the caller execs it); Docker Desktop accepts a `D:\path` host mount as-is.
 */
export function containerInstallArgs(hostDir: string, image = "node:22-bookworm"): string[] {
  return ["run", "--rm", "-v", `${hostDir}:/app`, "-w", "/app", image, "npm", "install", "--no-audit", "--no-fund", "--loglevel=error"];
}

/**
 * Install the backend server's dependencies so the boot gate can actually run it. A build produces a
 * package.json but no node_modules — `node server.js` then dies on the first `import express`, which
 * is a missing-deps artifact, not a real bug. Booting a server without its deps is meaningless, so
 * (opt-in, before the boot gate) we `npm install` in the detected server's module. Bounded + best-
 * effort: a failed/slow install just leaves the boot gate inconclusive, it never throws.
 */
export function ensureServerDeps(cwd: string, files: SourceFile[], opts: { timeoutMs?: number } = {}): DepInstall {
  const server = detectServerEntry(files);
  if (!server) return { installed: false, reason: "no server module" };
  const dir = join(cwd, server.dir);
  if (existsSync(join(dir, "node_modules"))) return { installed: false, reason: "already installed", dir };
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return { installed: false, reason: "no package.json", dir };
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { dependencies?: object; devDependencies?: object };
    if (!pkg.dependencies && !pkg.devDependencies) return { installed: false, reason: "no dependencies to install", dir };
  } catch {
    return { installed: false, reason: "unreadable package.json", dir };
  }
  const timeoutMs = opts.timeoutMs ?? 240000;
  // Opt-in (CHORALE_BOOT_CONTAINER=1): install inside a toolchain container so a native module with no
  // prebuild still compiles. Only when a daemon is actually reachable; any container failure falls
  // through to the local install below rather than blocking.
  if (process.env.CHORALE_BOOT_CONTAINER === "1" && dockerAvailable()) {
    try {
      execFileSync("docker", containerInstallArgs(dir), { timeout: timeoutMs, stdio: ["ignore", "ignore", "pipe"] });
      return { installed: true, dir };
    } catch {
      /* container install failed/unavailable — fall back to a local install */
    }
  }
  try {
    execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], {
      cwd: dir,
      timeout: timeoutMs,
      stdio: ["ignore", "ignore", "pipe"], // capture npm's stderr — "Command failed" alone is unactionable
      shell: process.platform === "win32",
    });
    return { installed: true, dir };
  } catch (e) {
    const err = e as { stderr?: Buffer | string; signal?: string; message?: string };
    if (err.signal === "SIGTERM" || /ETIMEDOUT|timed out/i.test(String(err.message ?? ""))) {
      return { installed: false, kind: "timeout", reason: `npm install timed out after ${Math.round(timeoutMs / 1000)}s (often a slow native build) — not a code problem`, dir };
    }
    const c = classifyInstallError(err.stderr ? String(err.stderr) : "");
    return { installed: false, kind: c.kind, failedModule: c.failedModule, reason: c.detail || String(err.message ?? "").slice(0, 200), dir };
  }
}

/**
 * Classify an npm-install stderr into a repair-relevant kind:
 *  - "resolution"   — npm can't resolve a version (a hallucinated/nonexistent one). Repairable.
 *  - "native-build" — a native addon failed to compile: no prebuilt binary for this Node and no C++
 *    toolchain (node-gyp / prebuild-install / "find VS" / MSBuild). Usually a STALE native dep pinned
 *    to a major that predates the running Node — bumping it to a current major with a prebuild fixes it
 *    with no compiler, so it's repairable, and we name the offending module.
 *  - "other"        — network / unknown. Not a code bug.
 */
export function classifyInstallError(stderr: string): { kind: "resolution" | "native-build" | "other"; failedModule?: string; detail: string } {
  if (/node-gyp|prebuild-install|gyp ERR|find VS|MSB\d|node_pre_gyp|Visual Studio/i.test(stderr)) {
    const mod = stderr.match(/node_modules[\\/]((?:@[^\\/\n]+[\\/])?[^\\/\n]+)/)?.[1]?.replace(/\\/g, "/");
    return { kind: "native-build", failedModule: mod, detail: `the native module${mod ? ` "${mod}"` : ""} has no prebuilt binary for Node ${process.versions.node} and no C++ toolchain is available to compile it` };
  }
  if (/ETARGET|notarget|No matching version|404 Not Found|ERESOLVE|EUNSUPPORTEDPROTOCOL|Invalid package name/i.test(stderr)) {
    return { kind: "resolution", detail: npmError(stderr) };
  }
  return { kind: "other", detail: npmError(stderr) };
}

/**
 * Convenience: detect the server, boot it (through its real runner), and return issues. `[]` if there's
 * no server to boot. `opts.contractEndpoints` (the planner's designed contract) is merged with the
 * endpoints extracted from the code, so probing exercises the agreed API surface even for routes the
 * static extractor missed.
 */
export async function smokeRun(cwd: string, files: SourceFile[], opts: { timeoutMs?: number; contractEndpoints?: string[]; legacyNodeBoot?: boolean } = {}): Promise<SmokeIssue[]> {
  const server = detectServerEntry(files);
  if (!server) return [];
  const built = extractContract(files);
  const contract: ProjectContract = { ...built, endpoints: [...new Set([...built.endpoints, ...(opts.contractEndpoints ?? [])])] };
  const launch = opts.legacyNodeBoot ? { runner: "node" as const, entry: server.entry } : bootLaunch(files, server);
  return bootAndProbe(cwd + "/" + server.dir, server.entry, contract, { timeoutMs: opts.timeoutMs, launch });
}

export function smokeRunFeedback(issues: SmokeIssue[]): string {
  if (issues.length === 0) return "";
  return "The app was booted and does not run correctly. Fix each of these (write the corrected files):\n" + issues.map((i) => `- ${i.message}`).join("\n");
}

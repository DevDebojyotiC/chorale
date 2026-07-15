import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveInside } from "../tools/permissions.js";
import { diagnose } from "./diagnose.js";

/**
 * Runtime self-healing checks — the layer beyond syntax verification. Instead of
 * trusting the model to follow instructions, we RUN what it wrote and observe:
 *  - a file that looks like a server is booted with an injected PORT and probed on
 *    that port (catches hardcoded ports / servers that never come up);
 *  - a module with exports is smoke-imported (catches "compiles but throws on load").
 * Failures are fed back into the repair loop exactly like syntax issues.
 */
export interface SmokeIssue {
  file: string;
  message: string;
}

const SERVER_RE = /\.listen\s*\(|createServer|http2?\.createServer|new\s+\w*Server\s*\(|Bun\.serve|Deno\.serve|\bapp\.listen\b/;
const MODULE_RE = /\bexport\s|\bmodule\.exports\b|\bexports\.[\w$]/;

const freePort = (): Promise<number> =>
  new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });

const canConnect = (port: number): Promise<boolean> =>
  new Promise((res) => {
    const sock = net.connect(port, "127.0.0.1");
    const done = (v: boolean): void => { sock.destroy(); res(v); };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    setTimeout(() => done(false), 500);
  });

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Boot/import each written module and report anything that fails to run. */
export async function smokeTest(files: string[], cwd: string): Promise<SmokeIssue[]> {
  const issues: SmokeIssue[] = [];
  for (const file of files) {
    if (![".mjs", ".js", ".cjs"].includes(extname(file).toLowerCase())) continue;
    let abs: string;
    let code: string;
    try { abs = resolveInside(cwd, file); code = readFileSync(abs, "utf8"); } catch { continue; }

    if (SERVER_RE.test(code)) {
      // Boot it with an injected port and confirm it actually listens THERE.
      const port = await freePort();
      const child = spawn("node", [abs], { cwd, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
      let up = false;
      for (let i = 0; i < 20; i++) { if (await canConnect(port)) { up = true; break; } await delay(200); }
      try { child.kill(); } catch { /* ignore */ }
      try { if (child.pid) execFileSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" }); } catch { /* non-windows / already gone */ }
      if (!up) {
        issues.push({
          file,
          message: `it was started with process.env.PORT=${port} but nothing was listening on port ${port} within ~4s. Read the port from process.env.PORT (use any default only as a fallback), and make sure the server actually calls listen() and starts without throwing.`,
        });
      }
    } else if (MODULE_RE.test(code)) {
      // Smoke-import: does the module load without throwing?
      const url = pathToFileURL(abs).href;
      try {
        execFileSync("node", ["-e", `import(${JSON.stringify(url)}).then(()=>process.exit(0)).catch(e=>{console.error(e&&e.stack||String(e));process.exit(1);})`], { cwd, timeout: 8000, stdio: ["ignore", "ignore", "pipe"] });
      } catch (e) {
        const x = e as { stderr?: Buffer | string; message?: string };
        const raw = (x.stderr ? x.stderr.toString() : "") || x.message || "failed to load";
        issues.push({ file, message: `throws when imported: ${raw.split("\n").filter(Boolean)[0]?.slice(0, 180) ?? "runtime error"}` });
      }
    }
  }
  return issues;
}

/** Corrective instruction for runtime (not syntax) failures, with targeted diagnosis. */
export function smokeFeedback(issues: SmokeIssue[]): string {
  const lines = issues.map((i) => `- ${i.file}: ${i.message}`).join("\n");
  const files = [...new Set(issues.map((i) => i.file))].join(", ");
  return (
    `Your code passed syntax checks but FAILED when actually run (${issues.length} runtime problem(s)). ` +
    `Fix ${files} so it runs correctly as specified, then rewrite the complete corrected file with the write tool. ` +
    `Do not add commentary — just make it run.${diagnose(issues.map((i) => i.message))}\n\n${lines}`
  );
}

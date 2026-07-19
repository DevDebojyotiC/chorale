/**
 * Remote hosts — SSH/SFTP for the "remote workspace" feature. A session's folder can be a remote URI
 * (ssh://<hostId>/<abs-path>); the desktop's fs handlers and (later) the agent's tools run over these
 * connections. Profiles persist to workspace/remote-hosts.json; SECRETS ARE NEVER PERSISTED — auth is
 * either the OpenSSH agent or a private-key file on disk (read at connect time).
 */
import { Client, type ConnectConfig } from "ssh2";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { RemoteHost, RemoteHostInput, RemoteTestResult, DirEntry, FilePreview, FileRef, GitStatus, GitChange } from "./shared/ipc.js";

let hostsFile = "";
export function initRemote(workspaceDir: string): void {
  hostsFile = join(workspaceDir, "remote-hosts.json");
}

export function loadHosts(): RemoteHost[] {
  try {
    if (!existsSync(hostsFile)) return [];
    const raw = JSON.parse(readFileSync(hostsFile, "utf8")) as RemoteHost[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function persist(hosts: RemoteHost[]): void {
  writeFileSync(hostsFile, JSON.stringify(hosts, null, 2));
}

export function saveHost(input: RemoteHostInput): RemoteHost[] {
  const hosts = loadHosts();
  const host: RemoteHost = {
    id: input.id ?? randomUUID(),
    label: input.label.trim() || input.host,
    host: input.host.trim(),
    port: input.port || 22,
    username: input.username.trim(),
    auth: input.auth,
    privateKeyPath: input.auth === "key" ? (input.privateKeyPath?.trim() || null) : null,
  };
  const idx = hosts.findIndex((h) => h.id === host.id);
  if (idx >= 0) hosts[idx] = host;
  else hosts.push(host);
  persist(hosts);
  return hosts;
}

export function deleteHost(id: string): RemoteHost[] {
  const hosts = loadHosts().filter((h) => h.id !== id);
  persist(hosts);
  pool.get(id)?.end();
  pool.delete(id);
  return hosts;
}

/** Live connections, keyed by host id. */
const pool = new Map<string, Client>();

function agentPath(): string | undefined {
  if (process.env.SSH_AUTH_SOCK) return process.env.SSH_AUTH_SOCK;
  return process.platform === "win32" ? "\\\\.\\pipe\\openssh-ssh-agent" : undefined;
}

function connectConfig(h: RemoteHost): ConnectConfig {
  const cfg: ConnectConfig = { host: h.host, port: h.port, username: h.username, readyTimeout: 12_000 };
  if (h.auth === "key") {
    if (!h.privateKeyPath || !existsSync(h.privateKeyPath)) throw new Error(`Private key not found: ${h.privateKeyPath ?? "(none set)"}`);
    cfg.privateKey = readFileSync(h.privateKeyPath);
  } else {
    const agent = agentPath();
    if (!agent) throw new Error("No SSH agent found (set SSH_AUTH_SOCK, or run the OpenSSH agent).");
    cfg.agent = agent;
  }
  return cfg;
}

/** Get (or open) a ready connection for a host. */
export function connect(h: RemoteHost): Promise<Client> {
  const existing = pool.get(h.id);
  if (existing) return Promise.resolve(existing);
  return new Promise<Client>((resolve, reject) => {
    let cfg: ConnectConfig;
    try {
      cfg = connectConfig(h);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    const client = new Client();
    client
      .on("ready", () => {
        pool.set(h.id, client);
        client.on("close", () => pool.delete(h.id));
        resolve(client);
      })
      .on("error", (err) => {
        pool.delete(h.id);
        reject(err);
      })
      .connect(cfg);
  });
}

/** Quote a path for a POSIX shell (single-quote wrapping). */
function shq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Run a command on the host, optionally in `cwd`. */
export async function exec(h: RemoteHost, command: string, opts: { cwd?: string; timeoutMs?: number } = {}): Promise<ExecResult> {
  const client = await connect(h);
  const full = opts.cwd ? `cd ${shq(opts.cwd)} && ${command}` : command;
  return new Promise<ExecResult>((resolve, reject) => {
    client.exec(full, (err, stream) => {
      if (err) return reject(err);
      let stdout = "";
      let stderr = "";
      let code = 0;
      const timer = setTimeout(() => {
        stream.close();
        reject(new Error(`Command timed out after ${opts.timeoutMs ?? 60_000}ms`));
      }, opts.timeoutMs ?? 60_000);
      stream
        .on("close", (c: number) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code: code || c || 0 });
        })
        .on("exit", (c: number) => {
          code = c ?? 0;
        })
        .on("data", (d: Buffer) => {
          stdout += d.toString("utf8");
        });
      stream.stderr.on("data", (d: Buffer) => {
        stderr += d.toString("utf8");
      });
    });
  });
}

/** Run an SFTP operation with a fresh SFTP channel. */
function withSftp<T>(h: RemoteHost, fn: (sftp: import("ssh2").SFTPWrapper) => Promise<T>): Promise<T> {
  return connect(h).then(
    (client) =>
      new Promise<T>((resolve, reject) => {
        client.sftp((err, sftp) => {
          if (err) return reject(err);
          fn(sftp).then(resolve, reject);
        });
      }),
  );
}

export interface RemoteEntry {
  name: string;
  isDir: boolean;
}

export function sftpReaddir(h: RemoteHost, dir: string): Promise<RemoteEntry[]> {
  return withSftp(h, (sftp) =>
    new Promise<RemoteEntry[]>((resolve, reject) => {
      sftp.readdir(dir, (err, list) => {
        if (err) return reject(err);
        resolve(list.map((e) => ({ name: e.filename, isDir: (e.attrs.mode & 0o170000) === 0o040000 })));
      });
    }),
  );
}

export function sftpStat(h: RemoteHost, path: string): Promise<{ isDir: boolean; size: number } | null> {
  return withSftp(h, (sftp) =>
    new Promise<{ isDir: boolean; size: number } | null>((resolve) => {
      sftp.stat(path, (err, st) => {
        if (err) return resolve(null);
        resolve({ isDir: st.isDirectory(), size: st.size });
      });
    }),
  );
}

export function sftpReadFile(h: RemoteHost, path: string): Promise<Buffer> {
  return withSftp(h, (sftp) =>
    new Promise<Buffer>((resolve, reject) => {
      sftp.readFile(path, (err, data) => (err ? reject(err) : resolve(data as Buffer)));
    }),
  );
}

export function sftpWriteFile(h: RemoteHost, path: string, content: string): Promise<void> {
  return withSftp(h, (sftp) =>
    new Promise<void>((resolve, reject) => {
      sftp.writeFile(path, content, (err) => (err ? reject(err) : resolve()));
    }),
  );
}

/** Connect + run a trivial command; report reachability + latency. */
export async function testHost(h: RemoteHost): Promise<RemoteTestResult> {
  const started = Date.now();
  try {
    const r = await exec(h, "echo chorale-ok && uname -a 2>/dev/null || ver", { timeoutMs: 12_000 });
    return { ok: r.stdout.includes("chorale-ok"), detail: r.stdout.trim().split("\n").slice(-1)[0]?.slice(0, 80) || "connected", ms: Date.now() - started };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - started };
  }
}

/** Close all pooled connections (on quit). */
export function closeAllRemotes(): void {
  for (const c of pool.values()) c.end();
  pool.clear();
}

// ─── Remote filesystem (ssh:// URIs) ─────────────────────────────────────────
// A remote folder is `ssh://<hostId><abs-posix-path>`. These functions return the
// SAME shapes as the local desktop fs handlers, so the renderer is scheme-agnostic.

export const isRemote = (s: string | null | undefined): boolean => !!s && s.startsWith("ssh://");

export function parseRemote(uri: string): { host: RemoteHost; path: string } | null {
  if (!uri.startsWith("ssh://")) return null;
  const rest = uri.slice("ssh://".length);
  const slash = rest.indexOf("/");
  const hostId = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? "/" : rest.slice(slash) || "/";
  const host = loadHosts().find((h) => h.id === hostId);
  return host ? { host, path } : null;
}

export const remoteUri = (hostId: string, path: string): string => `ssh://${hostId}${path.startsWith("/") ? path : "/" + path}`;

const posixJoin = (base: string, name: string): string => (base.replace(/\/+$/, "") || "") + "/" + name;
function posixRel(from: string, to: string): string {
  const f = from.replace(/\/+$/, "");
  if (to === f) return ".";
  return to.startsWith(f + "/") ? to.slice(f.length + 1) : to;
}

const IMG_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".bmp": "image/bmp" };

export async function remoteReadDir(uri: string): Promise<DirEntry[]> {
  const r = parseRemote(uri);
  if (!r) return [];
  const entries = await sftpReaddir(r.host, r.path);
  return entries
    .map((e) => ({ name: e.name, path: remoteUri(r.host.id, posixJoin(r.path, e.name)), type: (e.isDir ? "dir" : "file") as "file" | "dir" }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
}

export async function remoteReadFile(uri: string): Promise<FilePreview> {
  const r = parseRemote(uri);
  if (!r) return { path: uri, kind: "error", content: "Unknown remote host." };
  try {
    const st = await sftpStat(r.host, r.path);
    if (!st) return { path: uri, kind: "error", content: "File not found." };
    const dot = r.path.lastIndexOf(".");
    const ext = dot >= 0 ? r.path.slice(dot).toLowerCase() : "";
    if (IMG_MIME[ext] && st.size <= 3 * 1024 * 1024) {
      const buf = await sftpReadFile(r.host, r.path);
      return { path: uri, kind: "image", content: `data:${IMG_MIME[ext]};base64,${buf.toString("base64")}` };
    }
    if (st.size > 512 * 1024) return { path: uri, kind: "toobig", content: `File is ${(st.size / 1024).toFixed(0)} KB — too large to preview.` };
    const buf = await sftpReadFile(r.host, r.path);
    if (buf.subarray(0, 8000).includes(0)) return { path: uri, kind: "binary", content: "Binary file — no preview." };
    return { path: uri, kind: "text", content: buf.toString("utf8") };
  } catch (e) {
    return { path: uri, kind: "error", content: e instanceof Error ? e.message : String(e) };
  }
}

export async function remoteListFiles(uri: string): Promise<FileRef[]> {
  const r = parseRemote(uri);
  if (!r) return [];
  try {
    const find = `find . \\( -name node_modules -o -name .git -o -name dist -o -name build -o -name .next -o -name coverage \\) -prune -o -type f -print 2>/dev/null | head -n 4000`;
    const { stdout } = await exec(r.host, find, { cwd: r.path, timeoutMs: 20_000 });
    return stdout
      .split("\n")
      .map((s) => s.replace(/^\.\//, "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((relPath) => ({ rel: relPath, path: remoteUri(r.host.id, posixJoin(r.path, relPath)) }));
  } catch {
    return [];
  }
}

function parseRemoteStatus(hostId: string, top: string, porcelain: string): GitChange[] {
  const out: GitChange[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) continue;
    const x = line[0]!;
    const y = line[1]!;
    let rel = line.slice(3);
    if (rel.includes(" -> ")) rel = rel.split(" -> ")[1]!;
    if (rel.startsWith('"') && rel.endsWith('"')) rel = rel.slice(1, -1);
    const code = x === "?" ? "?" : x !== " " ? x : y;
    let status: GitChange["status"];
    if (x === "?" || y === "?") status = "untracked";
    else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) status = "conflict";
    else if (code === "A") status = "added";
    else if (code === "D") status = "deleted";
    else if (code === "R") status = "renamed";
    else status = "modified";
    out.push({ path: remoteUri(hostId, posixJoin(top, rel)), file: rel, status, staged: x !== " " && x !== "?" });
  }
  return out;
}

export async function remoteGitStatus(uri: string): Promise<GitStatus> {
  const r = parseRemote(uri);
  if (!r) return { repo: false, branch: null, changes: [] };
  try {
    const topRes = await exec(r.host, "git rev-parse --show-toplevel", { cwd: r.path, timeoutMs: 15_000 });
    if (topRes.code !== 0) return { repo: false, branch: null, changes: [] };
    const top = topRes.stdout.trim();
    let branch: string | null = null;
    const b = await exec(r.host, "git rev-parse --abbrev-ref HEAD", { cwd: top, timeoutMs: 10_000 });
    if (b.code === 0) branch = b.stdout.trim();
    const st = await exec(r.host, "git status --porcelain=v1 -uall", { cwd: top, timeoutMs: 20_000 });
    return { repo: true, branch, changes: parseRemoteStatus(r.host.id, top, st.stdout) };
  } catch {
    return { repo: false, branch: null, changes: [] };
  }
}

export async function remoteGitDiff(folderUri: string, fileUri: string): Promise<string> {
  const rf = parseRemote(folderUri);
  const rfile = parseRemote(fileUri);
  if (!rf || !rfile) return "";
  try {
    const top = (await exec(rf.host, "git rev-parse --show-toplevel", { cwd: rf.path, timeoutMs: 15_000 })).stdout.trim();
    if (!top) return "";
    const rel = posixRel(top, rfile.path);
    const tracked = await exec(rf.host, `git ls-files --error-unmatch -- ${shq(rel)}`, { cwd: top, timeoutMs: 10_000 });
    if (tracked.code !== 0) {
      const st = await sftpStat(rfile.host, rfile.path);
      if (!st) return "";
      if (st.size > 512 * 1024) return `+ (new file — ${(st.size / 1024).toFixed(0)} KB, too large to preview)`;
      const buf = await sftpReadFile(rfile.host, rfile.path);
      if (buf.subarray(0, 8000).includes(0)) return "+ (new binary file — no preview)";
      const lines = buf.toString("utf8").replace(/\n$/, "").split("\n");
      return `--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => "+" + l).join("\n");
    }
    return (await exec(rf.host, `git diff HEAD -- ${shq(rel)}`, { cwd: top, timeoutMs: 20_000 })).stdout;
  } catch {
    return "";
  }
}

/** The home directory on a host (for the remote folder picker's starting point). */
export async function remoteHome(hostId: string): Promise<string> {
  const host = loadHosts().find((h) => h.id === hostId);
  if (!host) return "/";
  try {
    const r = await exec(host, "pwd", { timeoutMs: 10_000 });
    return r.stdout.trim() || "/";
  } catch {
    return "/";
  }
}

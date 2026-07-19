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
import type { RemoteHost, RemoteHostInput, RemoteTestResult } from "./shared/ipc.js";

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

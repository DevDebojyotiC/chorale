import { resolve, sep, relative, posix as posixPath } from "node:path";
import readline from "node:readline";

/**
 * Approval tiers, mirroring the industry standard (Claude Code / Codex / Antigravity):
 * - read-only : inspect only (no writes, no shell)          [~ plan / suggest]
 * - auto-edit : edits auto-applied; shell needs approval     [~ acceptEdits / auto-edit]
 * - full-auto : edits + shell run automatically              [~ bypass / full-auto]
 * File operations are always sandboxed to the workspace root; a catastrophic-command
 * denylist is enforced for shell even in full-auto.
 */
export type PermissionMode = "read-only" | "auto-edit" | "full-auto";

/**
 * A pluggable filesystem + shell the tools run against. When absent, tools use the local Node fs/shell
 * (the default — the 370 core tests exercise this path unchanged). When present (e.g. an SSH/SFTP
 * backend for a remote workspace), the file + shell tools route every operation through it instead.
 * Paths handed to a backend are backend-absolute (POSIX for a remote host).
 */
export interface ToolBackend {
  exec(command: string, opts: { cwd: string; timeoutMs: number }): Promise<{ stdout: string; stderr: string; code: number }>;
  readFile(absPath: string): Promise<string>;
  writeFile(absPath: string, content: string): Promise<void>;
  mkdirp(absDir: string): Promise<void>;
  exists(absPath: string): Promise<boolean>;
  isDirectory(absPath: string): Promise<boolean>;
  readdir(absDir: string): Promise<{ name: string; isDir: boolean }[]>;
  rename(fromAbs: string, toAbs: string): Promise<void>;
}

export interface ToolContext {
  mode: PermissionMode;
  /** Workspace root; all file operations are confined here. */
  cwd: string;
  /** When set, file/shell tools run against this backend (remote SSH) instead of the local fs. */
  backend?: ToolBackend;
  /** True when cwd/paths use POSIX semantics (a remote host); drives resolveInside/rel. */
  posix?: boolean;
  /** If provided, write/edit tools record the (workspace-relative) files they touch here. */
  touched?: Set<string>;
  /** If provided, edit tools snapshot a file's ORIGINAL content here the first time they change it
   * (for the meaning-preservation check — facts present before an edit must survive it). */
  originals?: Map<string, string>;
  /** If provided, read tools append the content they return here (the "source of truth" this turn) —
   * used by the design-mode fidelity check to catch fabricated data in a model-authored artifact. */
  reads?: string[];
}

/** Resolve `p` against the workspace root and refuse if it escapes it. Set `posix` for a remote host. */
export function resolveInside(cwd: string, p: string, posix = false): string {
  const P = posix ? posixPath : { resolve, sep };
  const root = P.resolve(cwd);
  const target = P.resolve(root, p);
  if (target !== root && !target.startsWith(root + P.sep)) {
    throw new Error(`Path "${p}" escapes the workspace root.`);
  }
  return target;
}

/** Workspace-relative display path. Set `posix` for a remote host. */
export function rel(cwd: string, abs: string, posix = false): string {
  const P = posix ? posixPath : { resolve, relative, sep };
  const r = P.relative(P.resolve(cwd), abs);
  return r === "" ? "." : r.split(P.sep).join("/");
}

/** Directory segments never traversed by glob/grep. */
export const SKIP_DIRS = new Set([".git", "node_modules", "dist", "data", ".next", "coverage"]);

/** Catastrophic shell patterns — refused in every mode (defense in depth, not a sandbox). */
const CATASTROPHIC: RegExp[] = [
  /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\b[^|;&]*\s(\/|~|\$HOME)(\s|$)/i, // rm -rf / ~ $HOME
  /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+\*/i, // rm -rf *
  /:\s*\(\s*\)\s*\{[^}]*\|[^}]*&[^}]*\}\s*;/, // fork bomb
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\b[^|;&]*\bof=\/dev\/(sd|nvme|disk|hd)/i,
  /\b(shutdown|reboot|halt|poweroff|init\s+0)\b/i,
  /\bformat\s+[a-z]:/i,
  />\s*\/dev\/(sd|nvme|disk|hd)[a-z]/i,
];

export function isCatastrophic(command: string): boolean {
  return CATASTROPHIC.some((re) => re.test(command));
}

/**
 * A non-TTY approval hook (e.g. a desktop GUI dialog). When set, it takes precedence over the terminal
 * prompt, so a GUI can approve shell commands the same way the CLI does over a TTY. Unset by default,
 * so CLI/headless behavior is unchanged.
 */
let approver: ((question: string) => Promise<boolean>) | null = null;
export function setApprover(fn: ((question: string) => Promise<boolean>) | null): void {
  approver = fn;
}

/** Ask for approval: a registered approver (GUI) if present, else a terminal y/N when interactive. */
export async function confirmTty(question: string): Promise<boolean> {
  if (approver) return approver(question);
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((res) => rl.question(question, res));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

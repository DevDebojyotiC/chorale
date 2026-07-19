/**
 * Remote counterparts of the local file + shell tools (fs.ts / shell.ts), used when a run has a
 * ToolBackend (an SSH/SFTP-backed remote workspace). Same tool NAMES and shapes as the local tools,
 * so the agent is oblivious to where it runs. File ops go over SFTP; ls/glob/grep and bash go over the
 * remote shell. Paths are POSIX and sandboxed to the (remote) workspace root via resolveInside.
 */
import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import { posix } from "node:path";
import { resolveInside, rel, isCatastrophic, confirmTty, type ToolContext, type ToolBackend } from "./permissions.js";

const READ_MAX = 30000;
const GLOB_MAX = 200;
const GREP_MAX = 100;
const OUTPUT_MAX = 10000;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;

const clip = (s: string): string => (s.length > OUTPUT_MAX ? s.slice(0, OUTPUT_MAX) + `\n…[truncated ${s.length - OUTPUT_MAX} chars]` : s);

function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if ("+.^${}()|[]\\".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

/** POSIX-shell single-quote. */
const shq = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'";

/** Recursively list workspace-relative files under `absDir` via the remote shell's `find`. */
async function remoteWalk(be: ToolBackend, cwd: string, absDir: string, cap: number): Promise<string[]> {
  const find = `find ${shq(absDir)} \\( -name node_modules -o -name .git -o -name dist -o -name build -o -name .next -o -name coverage \\) -prune -o -type f -print 2>/dev/null | head -n ${cap}`;
  const { stdout } = await be.exec(find, { cwd, timeoutMs: 30_000 });
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((abs) => rel(cwd, abs, true));
}

export function createRemoteFileTools(ctx: ToolContext): ToolSet {
  const { cwd } = ctx;
  const be = ctx.backend!;
  const inside = (p: string): string => resolveInside(cwd, p, true);
  const display = (abs: string): string => rel(cwd, abs, true);

  const read = tool({
    description: "Read a UTF-8 text file within the workspace. Returns its content (truncated if large).",
    inputSchema: z.object({ path: z.string().describe("Workspace-relative file path") }),
    execute: async ({ path }) => {
      try {
        const abs = inside(path);
        const text = await be.readFile(abs);
        ctx.reads?.push(text.slice(0, READ_MAX));
        return { path: display(abs), content: text.slice(0, READ_MAX), truncated: text.length > READ_MAX };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const write = tool({
    description: "Create or overwrite a text file within the workspace.",
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    execute: async ({ path, content }) => {
      try {
        const abs = inside(path);
        if (ctx.originals && (await be.exists(abs)) && !ctx.originals.has(display(abs))) {
          ctx.originals.set(display(abs), await be.readFile(abs));
        }
        await be.mkdirp(posix.dirname(abs));
        await be.writeFile(abs, content);
        ctx.touched?.add(display(abs));
        return { path: display(abs), bytes: Buffer.byteLength(content) };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const applyEdits = async (abs: string, edits: Array<{ old_string: string; new_string: string; replace_all?: boolean }>) => {
    let text = await be.readFile(abs);
    if (ctx.originals && !ctx.originals.has(display(abs))) ctx.originals.set(display(abs), text);
    for (const ed of edits) {
      if (ed.old_string === ed.new_string) throw new Error("old_string and new_string are identical");
      const count = text.split(ed.old_string).length - 1;
      if (count === 0) throw new Error(`old_string not found: ${JSON.stringify(ed.old_string.slice(0, 60))}`);
      if (count > 1 && !ed.replace_all) throw new Error(`old_string is not unique (${count} matches); set replace_all or add context`);
      text = ed.replace_all ? text.split(ed.old_string).join(ed.new_string) : text.replace(ed.old_string, ed.new_string);
    }
    await be.writeFile(abs, text);
  };

  const edit = tool({
    description: "Replace an exact string in a file. old_string must match uniquely unless replace_all is set.",
    inputSchema: z.object({ path: z.string(), old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() }),
    execute: async ({ path, old_string, new_string, replace_all }) => {
      try {
        const abs = inside(path);
        await applyEdits(abs, [{ old_string, new_string, replace_all }]);
        ctx.touched?.add(display(abs));
        return { path: display(abs), ok: true };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const multi_edit = tool({
    description: "Apply multiple exact-string edits to one file, in order (all-or-nothing).",
    inputSchema: z.object({
      path: z.string(),
      edits: z.array(z.object({ old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() })).min(1),
    }),
    execute: async ({ path, edits }) => {
      try {
        const abs = inside(path);
        await applyEdits(abs, edits);
        ctx.touched?.add(display(abs));
        return { path: display(abs), edits: edits.length, ok: true };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const move = tool({
    description: "Move or rename a file within the workspace. Refuses if the destination exists.",
    inputSchema: z.object({ from: z.string(), to: z.string() }),
    execute: async ({ from, to }) => {
      try {
        const src = inside(from);
        const dst = inside(to);
        if (!(await be.exists(src))) return { error: `source not found: ${from}` };
        if (await be.isDirectory(src)) return { error: `"${from}" is a directory; move files individually` };
        if (await be.exists(dst)) return { error: `destination already exists: ${to}` };
        await be.mkdirp(posix.dirname(dst));
        await be.rename(src, dst);
        return { from: display(src), to: display(dst), moved: true, references: [] as { file: string; line: number; text: string }[] };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const ls = tool({
    description: "List a directory in the workspace. Set recursive to see a file tree.",
    inputSchema: z.object({ path: z.string().optional(), recursive: z.boolean().optional() }),
    execute: async ({ path, recursive }) => {
      try {
        const abs = inside(path ?? ".");
        if (recursive) return { path: display(abs), files: await remoteWalk(be, cwd, abs, GLOB_MAX) };
        const entries = (await be.readdir(abs)).map((e) => (e.isDir ? `${e.name}/` : e.name));
        return { path: display(abs), entries };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const glob = tool({
    description: "Find files by glob pattern (e.g. src/**/*.ts) within the workspace.",
    inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
    execute: async ({ pattern, path }) => {
      try {
        const abs = inside(path ?? ".");
        const re = globToRegExp(pattern);
        const all = await remoteWalk(be, cwd, abs, 5000);
        const matches = all.filter((f) => re.test(f)).slice(0, GLOB_MAX);
        return { pattern, matches, truncated: matches.length >= GLOB_MAX };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const grep = tool({
    description: "Search file contents for a regular expression. Returns matching file:line:text.",
    inputSchema: z.object({ pattern: z.string(), path: z.string().optional(), glob: z.string().optional() }),
    execute: async ({ pattern, path, glob }) => {
      try {
        const abs = inside(path ?? ".");
        try {
          new RegExp(pattern);
        } catch {
          return { error: `Invalid regex: ${pattern}` };
        }
        const inc = glob ? `--include=${shq(glob)}` : "";
        const cmd = `grep -rInE ${inc} --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build ${shq(pattern)} ${shq(abs)} 2>/dev/null | head -n ${GREP_MAX}`;
        const { stdout } = await be.exec(cmd, { cwd, timeoutMs: 30_000 });
        const results: Array<{ file: string; line: number; text: string }> = [];
        for (const line of stdout.split("\n")) {
          if (!line.trim()) continue;
          const m = line.match(/^(.*?):(\d+):(.*)$/);
          if (m) results.push({ file: rel(cwd, m[1]!, true), line: Number(m[2]), text: m[3]!.slice(0, 200) });
        }
        return { pattern, matches: results, truncated: results.length >= GREP_MAX };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  return { read, write, edit, multi_edit, move, ls, glob, grep };
}

export function createRemoteShellTools(ctx: ToolContext): ToolSet {
  const { mode, cwd } = ctx;
  const be = ctx.backend!;

  const bash = tool({
    description: "Run a shell command in the workspace directory (on the remote host). Prefer non-destructive commands.",
    inputSchema: z.object({ command: z.string(), timeout_ms: z.number().int().positive().max(MAX_TIMEOUT_MS).optional() }),
    execute: async ({ command, timeout_ms }) => {
      if (isCatastrophic(command)) return { error: "Refused: this command matches a catastrophic-command denylist and is never run." };
      if (mode === "auto-edit") {
        const ok = await confirmTty(`\n[chorale] allow remote shell command?\n  $ ${command}\n  [y/N] `);
        if (!ok) return { error: "Shell command not approved. In auto-edit mode, shell requires approval — or use full-auto." };
      }
      try {
        const r = await be.exec(command, { cwd, timeoutMs: timeout_ms ?? DEFAULT_TIMEOUT_MS });
        return { command, stdout: clip(r.stdout), stderr: clip(r.stderr), exitCode: r.code };
      } catch (e) {
        return { command, stdout: "", stderr: e instanceof Error ? e.message : String(e), exitCode: 1 };
      }
    },
  });

  return { bash };
}

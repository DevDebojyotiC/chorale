import { describe, it, expect, beforeEach } from "vitest";
import { createRemoteFileTools, createRemoteShellTools } from "../src/tools/remote-fs";
import type { ToolBackend } from "../src/tools/permissions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (t: any) => (i: any) => t.execute(i, {});

/** An in-memory POSIX filesystem standing in for an SSH/SFTP host. */
function fakeBackend(seed: Record<string, string>): { be: ToolBackend; files: Map<string, string>; execLog: string[] } {
  const files = new Map<string, string>(Object.entries(seed));
  const execLog: string[] = [];
  const dirsOf = (): Set<string> => {
    const d = new Set<string>();
    for (const p of files.keys()) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) d.add(parts.slice(0, i).join("/") || "/");
    }
    return d;
  };
  const be: ToolBackend = {
    exec: async (command, opts) => {
      execLog.push(command);
      // Minimal `find` support for ls -R / glob.
      const m = command.match(/^find '([^']+)'/);
      if (m) {
        const root = m[1]!.replace(/\/+$/, "");
        const hits = [...files.keys()].filter((f) => f === root || f.startsWith(root + "/"));
        return { stdout: hits.join("\n") + "\n", stderr: "", code: 0 };
      }
      return { stdout: `ran:${command} in ${opts.cwd}`, stderr: "", code: 0 };
    },
    readFile: async (p) => {
      if (!files.has(p)) throw new Error(`No such file: ${p}`);
      return files.get(p)!;
    },
    writeFile: async (p, c) => {
      files.set(p, c);
    },
    mkdirp: async () => {},
    exists: async (p) => files.has(p) || dirsOf().has(p),
    isDirectory: async (p) => dirsOf().has(p) && !files.has(p),
    readdir: async (d) => {
      const base = d.replace(/\/+$/, "");
      const names = new Set<{ name: string; isDir: boolean }>();
      const seen = new Map<string, boolean>();
      for (const f of files.keys()) {
        if (!f.startsWith(base + "/")) continue;
        const rest = f.slice(base.length + 1);
        const slash = rest.indexOf("/");
        if (slash < 0) seen.set(rest, false);
        else seen.set(rest.slice(0, slash), true);
      }
      for (const [name, isDir] of seen) names.add({ name, isDir });
      return [...names];
    },
    rename: async (from, to) => {
      execLog.push(`rename ${from} -> ${to}`);
      if (files.has(from)) {
        files.set(to, files.get(from)!);
        files.delete(from);
      }
    },
  };
  return { be, files, execLog };
}

const CWD = "/srv/app";

describe("remote tools — file ops over a backend", () => {
  let f: ReturnType<typeof fakeBackend>;
  let tools: ReturnType<typeof createRemoteFileTools>;
  beforeEach(() => {
    f = fakeBackend({
      "/srv/app/src/server.ts": 'import x from "y";\nconst port = 3000;\n',
      "/srv/app/README.md": "# app\n",
    });
    tools = createRemoteFileTools({ mode: "full-auto", cwd: CWD, backend: f.be, posix: true });
  });

  it("reads a file over the backend", async () => {
    const r = (await call(tools.read)({ path: "src/server.ts" })) as { content: string; path: string };
    expect(r.content).toContain("const port = 3000");
    expect(r.path).toBe("src/server.ts");
  });

  it("writes a new file into the remote workspace", async () => {
    const r = (await call(tools.write)({ path: "src/new.ts", content: "export const a = 1;\n" })) as { path: string; bytes: number };
    expect(r.path).toBe("src/new.ts");
    expect(f.files.get("/srv/app/src/new.ts")).toContain("export const a = 1");
  });

  it("edits an existing file with an exact-string replace", async () => {
    const r = (await call(tools.edit)({ path: "src/server.ts", old_string: "3000", new_string: "8080" })) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(f.files.get("/srv/app/src/server.ts")).toContain("const port = 8080");
  });

  it("refuses an edit whose old_string is missing", async () => {
    const r = (await call(tools.edit)({ path: "src/server.ts", old_string: "NOPE", new_string: "x" })) as { error?: string };
    expect(r.error).toMatch(/not found/);
  });

  it("moves a file and deletes the source", async () => {
    const r = (await call(tools.move)({ from: "README.md", to: "docs/README.md" })) as { moved?: boolean };
    expect(r.moved).toBe(true);
    expect(f.files.has("/srv/app/README.md")).toBe(false);
    expect(f.files.has("/srv/app/docs/README.md")).toBe(true);
  });

  it("lists a directory via the backend", async () => {
    const r = (await call(tools.ls)({ path: "src" })) as { entries: string[] };
    expect(r.entries).toContain("server.ts");
  });

  it("sandboxes paths to the (remote) workspace root", async () => {
    const r = (await call(tools.read)({ path: "../../etc/passwd" })) as { error?: string };
    expect(r.error).toMatch(/escapes/);
  });
});

describe("remote tools — shell over a backend", () => {
  it("runs bash through the backend exec", async () => {
    const f = fakeBackend({});
    const shell = createRemoteShellTools({ mode: "full-auto", cwd: CWD, backend: f.be, posix: true });
    const r = (await call(shell.bash)({ command: "ls -la" })) as { stdout: string; exitCode: number };
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("ls -la");
    expect(f.execLog).toContain("ls -la");
  });

  it("refuses catastrophic commands before they reach the host", async () => {
    const f = fakeBackend({});
    const shell = createRemoteShellTools({ mode: "full-auto", cwd: CWD, backend: f.be, posix: true });
    const r = (await call(shell.bash)({ command: "rm -rf /" })) as { error?: string };
    expect(r.error).toMatch(/denylist/);
    expect(f.execLog).toHaveLength(0);
  });
});

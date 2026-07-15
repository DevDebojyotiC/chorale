import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { resolveInside, rel, SKIP_DIRS, type ToolContext } from "./permissions.js";

const CODE_EXT = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts",
  ".html", ".htm", ".css", ".json", ".py", ".java", ".go", ".rs",
  ".c", ".h", ".cpp", ".rb", ".php", ".sh", ".yml", ".yaml",
]);

/**
 * Source-side tool-arg repair: some models emit an entire file as a single line
 * with literal "\n" escapes instead of real newlines. When the content is a code
 * file with NO real newlines but literal "\n" sequences, unescape it. (The mixed
 * case is handled downstream by the verify-repair loop.)
 */
function normalizeCodeContent(path: string, content: string): string {
  if (!CODE_EXT.has(extname(path).toLowerCase())) return content;
  if (!content.includes("\n") && /\\n/.test(content)) {
    return content.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }
  return content;
}

const READ_MAX = 30000;
const GLOB_MAX = 200;
const GREP_MAX = 100;

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

/** Recursively list workspace-relative file paths, skipping heavy dirs. */
function walkFiles(cwd: string, startAbs: string, cap: number): string[] {
  const out: string[] = [];
  const stack = [startAbs];
  while (stack.length && out.length < cap) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(join(dir, e.name));
      } else if (e.isFile()) {
        out.push(rel(cwd, join(dir, e.name)));
        if (out.length >= cap) break;
      }
    }
  }
  return out;
}

/** Build the file tools for a given permission context. */
export function createFileTools(ctx: ToolContext): ToolSet {
  const { cwd } = ctx;

  const read = tool({
    description: "Read a UTF-8 text file within the workspace. Returns its content (truncated if large).",
    inputSchema: z.object({ path: z.string().describe("Workspace-relative file path") }),
    execute: async ({ path }) => {
      try {
        const abs = resolveInside(cwd, path);
        const text = readFileSync(abs, "utf8");
        return { path: rel(cwd, abs), content: text.slice(0, READ_MAX), truncated: text.length > READ_MAX };
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
        const abs = resolveInside(cwd, path);
        const normalized = normalizeCodeContent(path, content);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, normalized, "utf8");
        ctx.touched?.add(rel(cwd, abs));
        return { path: rel(cwd, abs), bytes: Buffer.byteLength(normalized) };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const applyEdits = (abs: string, edits: Array<{ old_string: string; new_string: string; replace_all?: boolean }>) => {
    let text = readFileSync(abs, "utf8");
    for (const ed of edits) {
      if (ed.old_string === ed.new_string) throw new Error("old_string and new_string are identical");
      const count = text.split(ed.old_string).length - 1;
      if (count === 0) throw new Error(`old_string not found: ${JSON.stringify(ed.old_string.slice(0, 60))}`);
      if (count > 1 && !ed.replace_all) throw new Error(`old_string is not unique (${count} matches); set replace_all or add context`);
      text = ed.replace_all ? text.split(ed.old_string).join(ed.new_string) : text.replace(ed.old_string, ed.new_string);
    }
    writeFileSync(abs, text, "utf8");
  };

  const edit = tool({
    description: "Replace an exact string in a file. old_string must match uniquely unless replace_all is set.",
    inputSchema: z.object({
      path: z.string(),
      old_string: z.string(),
      new_string: z.string(),
      replace_all: z.boolean().optional(),
    }),
    execute: async ({ path, old_string, new_string, replace_all }) => {
      try {
        const abs = resolveInside(cwd, path);
        applyEdits(abs, [{ old_string, new_string, replace_all }]);
        ctx.touched?.add(rel(cwd, abs));
        return { path: rel(cwd, abs), ok: true };
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
        const abs = resolveInside(cwd, path);
        applyEdits(abs, edits);
        ctx.touched?.add(rel(cwd, abs));
        return { path: rel(cwd, abs), edits: edits.length, ok: true };
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
        const abs = resolveInside(cwd, path ?? ".");
        if (recursive) return { path: rel(cwd, abs), files: walkFiles(cwd, abs, GLOB_MAX) };
        const entries = readdirSync(abs, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        return { path: rel(cwd, abs), entries };
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
        const abs = resolveInside(cwd, path ?? ".");
        const re = globToRegExp(pattern);
        const all = walkFiles(cwd, abs, 5000);
        const matches = all.filter((f) => re.test(f)).slice(0, GLOB_MAX);
        return { pattern, matches, truncated: matches.length >= GLOB_MAX };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const grep = tool({
    description: "Search file contents for a regular expression. Returns matching file:line:text.",
    inputSchema: z.object({
      pattern: z.string(),
      path: z.string().optional(),
      glob: z.string().optional().describe("Optional file glob to restrict the search"),
    }),
    execute: async ({ pattern, path, glob }) => {
      try {
        const abs = resolveInside(cwd, path ?? ".");
        let re: RegExp;
        try {
          re = new RegExp(pattern);
        } catch {
          return { error: `Invalid regex: ${pattern}` };
        }
        const globRe = glob ? globToRegExp(glob) : null;
        const files = walkFiles(cwd, abs, 5000).filter((f) => !globRe || globRe.test(f));
        const results: Array<{ file: string; line: number; text: string }> = [];
        for (const f of files) {
          if (results.length >= GREP_MAX) break;
          let content: string;
          try {
            content = readFileSync(resolveInside(cwd, f), "utf8");
          } catch {
            continue;
          }
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i]!)) {
              results.push({ file: f, line: i + 1, text: lines[i]!.slice(0, 200) });
              if (results.length >= GREP_MAX) break;
            }
          }
        }
        return { pattern, matches: results, truncated: results.length >= GREP_MAX };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  return { read, write, edit, multi_edit, ls, glob, grep };
}

/** Names of read-only file tools (available in every mode). */
export const READ_ONLY_FILE_TOOLS = new Set(["read", "ls", "glob", "grep"]);
/** Names of mutating file tools (omitted in read-only mode). */
export const WRITE_FILE_TOOLS = new Set(["write", "edit", "multi_edit"]);

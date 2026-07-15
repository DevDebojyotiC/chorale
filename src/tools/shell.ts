import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { isCatastrophic, confirmTty, type ToolContext } from "./permissions.js";

const execAsync = promisify(exec);

const OUTPUT_MAX = 10000;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;

function clip(s: string): string {
  return s.length > OUTPUT_MAX ? s.slice(0, OUTPUT_MAX) + `\n…[truncated ${s.length - OUTPUT_MAX} chars]` : s;
}

/** Build the shell tools for a given permission context. */
export function createShellTools(ctx: ToolContext): ToolSet {
  const { mode, cwd } = ctx;

  const bash = tool({
    description:
      "Run a shell command in the workspace directory. Use for builds, tests, git, and file operations. Prefer non-destructive commands.",
    inputSchema: z.object({
      command: z.string().describe("The shell command to run"),
      timeout_ms: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
    }),
    execute: async ({ command, timeout_ms }) => {
      if (isCatastrophic(command)) {
        return { error: "Refused: this command matches a catastrophic-command denylist and is never run." };
      }
      // Approval: full-auto runs; auto-edit asks on a TTY (else denies); read-only never reaches here.
      if (mode === "auto-edit") {
        const ok = await confirmTty(`\n[chorale] allow shell command?\n  $ ${command}\n  [y/N] `);
        if (!ok) {
          return {
            error:
              "Shell command not approved. In auto-edit mode, shell requires approval (interactive y/N) — or re-run with --yolo for full-auto.",
          };
        }
      }
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd,
          timeout: timeout_ms ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        });
        return { command, stdout: clip(stdout), stderr: clip(stderr), exitCode: 0 };
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; code?: number; killed?: boolean; message?: string };
        return {
          command,
          stdout: clip(err.stdout ?? ""),
          stderr: clip(err.stderr ?? err.message ?? String(e)),
          exitCode: typeof err.code === "number" ? err.code : 1,
          killed: err.killed ?? false,
        };
      }
    },
  });

  return { bash };
}

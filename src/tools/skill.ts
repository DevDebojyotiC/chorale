import { tool } from "ai";
import { z } from "zod";
import type { SkillSpec } from "../skills/loader.js";
import { readSkillBody, readSkillFile } from "../skills/loader.js";

const BODY_MAX = 8000;
const FILE_MAX = 6000;

/**
 * Build a `skill_view` tool scoped to a specific set of skills. Progressive
 * disclosure: the agent sees only skill names+descriptions in its prompt, then
 * loads a skill's full body (or a bundled reference file) on demand via this tool.
 */
export function createSkillViewTool(skills: SkillSpec[]) {
  const byName = new Map(skills.map((s) => [s.name, s]));
  return tool({
    description:
      "Load a skill's full instructions when a task matches its description. Optionally read a reference file bundled inside the skill.",
    inputSchema: z.object({
      name: z.string().describe("The skill name to load"),
      path: z
        .string()
        .optional()
        .describe("Optional reference file path inside the skill to read instead of the main SKILL.md body"),
    }),
    execute: async ({ name, path }) => {
      const spec = byName.get(name);
      if (!spec) {
        return { error: `Unknown skill "${name}". Available: ${[...byName.keys()].join(", ") || "(none)"}` };
      }
      try {
        if (path) return { name, path, content: readSkillFile(spec, path).slice(0, FILE_MAX) };
        return { name, content: readSkillBody(spec).slice(0, BODY_MAX) };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}

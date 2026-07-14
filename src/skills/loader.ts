import { readdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import matter from "gray-matter";

/**
 * A skill on disk: a directory with a `SKILL.md` (YAML frontmatter + markdown body),
 * Claude-Code / agentskills.io compatible. Only `name` + `description` are required;
 * Chorale-specific extras live under a `metadata.chorale` namespace and are ignored elsewhere.
 */
export interface SkillSpec {
  name: string;
  description: string;
  /** Absolute directory containing SKILL.md (and any reference files). */
  dir: string;
  /** Absolute path to SKILL.md. */
  file: string;
}

/** Discover skills across one or more directories (e.g. `skills/`, `.claude/skills/`). */
export function discoverSkills(dirs: string[]): Map<string, SkillSpec> {
  const skills = new Map<string, SkillSpec>();
  for (const d of dirs) {
    const base = resolve(d);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      const dir = join(base, entry);
      const file = join(dir, "SKILL.md");
      if (!existsSync(file) || !statSync(dir).isDirectory()) continue;
      try {
        const { data } = matter(readFileSync(file, "utf8"));
        const name = data.name ? String(data.name) : entry;
        const description = data.description ? String(data.description) : "";
        if (!description) continue; // a skill needs a description to be discoverable
        skills.set(name, { name, description, dir, file });
      } catch {
        /* skip malformed SKILL.md */
      }
    }
  }
  return skills;
}

/** The full markdown body of a skill (loaded on demand — progressive disclosure). */
export function readSkillBody(spec: SkillSpec): string {
  const { content } = matter(readFileSync(spec.file, "utf8"));
  return content.trim();
}

/** Read a reference file bundled inside a skill directory (traversal-guarded). */
export function readSkillFile(spec: SkillSpec, relPath: string): string {
  const target = resolve(spec.dir, relPath);
  const root = resolve(spec.dir);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error("Path escapes the skill directory");
  }
  return readFileSync(target, "utf8");
}

/** Resolve an agent's skill allow-list against discovered skills. */
export function selectSkills(all: Map<string, SkillSpec>, names: string[]): SkillSpec[] {
  return names
    .map((n) => all.get(n))
    .filter((s): s is SkillSpec => Boolean(s));
}

/** Render the injected "available skills" block (names + descriptions only). */
export function renderSkillsForPrompt(specs: SkillSpec[]): string {
  if (specs.length === 0) return "";
  const lines = specs.map((s) => `- ${s.name}: ${s.description}`);
  return (
    `## Available skills\n` +
    `When a task matches a skill below, call the \`skill_view\` tool with its name to load full instructions before proceeding.\n` +
    `${lines.join("\n")}\n\n`
  );
}

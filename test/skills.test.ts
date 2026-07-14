import { describe, it, expect } from "vitest";
import {
  discoverSkills,
  selectSkills,
  readSkillBody,
  renderSkillsForPrompt,
} from "../src/skills/loader";

describe("Phase 1 — SKILL.md loader", () => {
  const skills = discoverSkills(["skills"]);

  it("discovers the summarize skill from skills/", () => {
    expect(skills.has("summarize")).toBe(true);
    expect(skills.get("summarize")?.description).toMatch(/summar/i);
  });

  it("loads a skill body on demand with frontmatter stripped", () => {
    const spec = skills.get("summarize")!;
    const body = readSkillBody(spec);
    expect(body).toMatch(/# Summarize/);
    expect(body).not.toMatch(/^description:/m);
  });

  it("renders only names+descriptions for the prompt (progressive disclosure)", () => {
    const block = renderSkillsForPrompt(selectSkills(skills, ["summarize"]));
    expect(block).toContain("summarize:");
    expect(block).not.toContain("# Summarize"); // body must NOT be injected upfront
  });

  it("ignores unknown skill names in an agent's allow-list", () => {
    expect(selectSkills(skills, ["does-not-exist"]).length).toBe(0);
  });
});

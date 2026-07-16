/**
 * Live smoke of the scribe's reference-safe file move: set up a tiny docs tree where
 * one file links to another, ask the scribe to rename the target, and check that the
 * file moved AND the link was updated. Usage: npx tsx eval/scribe-smoke.ts ["<model>"]
 */
import "dotenv/config";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";

process.env.CHORALE_NO_LEARN = "1";
const model = process.argv[2] ?? "hf:google/gemma-4-31B-it";
const repoRoot = process.cwd();
const config = loadConfig();
config.agents.dir = resolve(repoRoot, config.agents.dir); // absolute — we chdir into a temp workspace
const registry = buildRegistry(config);
const scribe = loadAgent(resolve(repoRoot, "agents/scribe.md"));

const dir = mkdtempSync(join(tmpdir(), "chorale-scribe-"));
mkdirSync(join(dir, "docs"), { recursive: true });
writeFileSync(join(dir, "docs", "intro.md"), "# Intro\n\nSee the [user guide](../guide.md) for details.\n");
writeFileSync(join(dir, "guide.md"), "# Guide\n\nHow to use the thing.\n");

process.stdout.write(`\n===== scribe file-move smoke · ${model} =====\nworkspace: ${dir}\n`);
try {
  process.chdir(dir);
  await runAgent({
    config,
    registry,
    agent: scribe,
    prompt: "Rename the file guide.md to user-guide.md, and update every reference to it so no link breaks.",
    modelOverride: model,
    permissionMode: "full-auto",
    stream: false,
  });
} finally {
  process.chdir(repoRoot);
}

const movedOk = existsSync(join(dir, "user-guide.md")) && !existsSync(join(dir, "guide.md"));
const intro = existsSync(join(dir, "docs", "intro.md")) ? readFileSync(join(dir, "docs", "intro.md"), "utf8") : "";
const linkOk = intro.includes("user-guide.md") && !intro.includes("(../guide.md)");
process.stdout.write(`\n  ${movedOk ? "✓" : "✗"} file renamed (guide.md → user-guide.md)\n`);
process.stdout.write(`  ${linkOk ? "✓" : "✗"} link in docs/intro.md updated\n`);
process.stdout.write(`  --- docs/intro.md ---\n${intro}\n`);
rmSync(dir, { recursive: true, force: true });
process.exit(movedOk && linkOk ? 0 : 1);

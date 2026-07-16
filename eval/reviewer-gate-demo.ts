/**
 * Live demo of the coder → reviewer gate: the coder writes code that is syntactically
 * valid (verify passes) but has a semantic/security bug; the review gate catches it and
 * loops back for a fix. Prints the gate activity and the final file.
 * Usage: npx tsx eval/reviewer-gate-demo.ts ["<provider:model>"]
 */
import "dotenv/config";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { setLogLevel } from "../src/core/log.js";

process.env.CHORALE_NO_LEARN = "1";
setLogLevel("info"); // so the "review gate" activity is visible

const model = process.argv[2] ?? "hf:google/gemma-4-31B-it";
const repoRoot = process.cwd();
const config = loadConfig();
// This demo chdir's into a temp workspace, so make the agents dir absolute (in production
// cwd is the project root and the gate resolves agents/reviewer.md correctly on its own).
config.agents.dir = resolve(repoRoot, config.agents.dir);
const registry = buildRegistry(config);
const coder = loadAgent(resolve(repoRoot, "agents/coder.md"));
const dir = mkdtempSync(join(tmpdir(), "chorale-gate-"));

process.stdout.write(`\n===== review-gate demo · coder=${model} · gate reviewer=default =====\n`);
try {
  process.chdir(dir);
  await runAgent({
    config,
    registry,
    agent: coder,
    prompt:
      "Create a file named auth.mjs that exports a function `findUser(db, name)`. It must build the SQL " +
      "string `SELECT * FROM users WHERE name = '<name>'` and run it via `db.query(sql)`, returning the " +
      "first row. Keep it to just that one function.",
    modelOverride: model,
    permissionMode: "full-auto",
    stream: false,
  });
  process.chdir(repoRoot);
  const f = readdirSync(dir).find((n) => n.endsWith(".mjs"));
  process.stdout.write(`\n----- final ${f} -----\n`);
  if (f && existsSync(join(dir, f))) process.stdout.write(readFileSync(join(dir, f), "utf8") + "\n");
} finally {
  process.chdir(repoRoot);
  rmSync(dir, { recursive: true, force: true });
}
process.exit(0);

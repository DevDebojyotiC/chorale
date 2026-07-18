/**
 * Contract-first A/B build harness (Phase 4). Runs the SAME fullstack prompt through the orchestrator's
 * full plan-exec pipeline, either with the contract-first system ON or OFF (CHORALE_NO_CONTRACT=1), into
 * an isolated experiments/<name> dir — so the two arms are directly comparable on the same binary.
 *
 *   npx tsx eval/ab-build.ts off ab-off
 *   npx tsx eval/ab-build.ts on  ab-on
 */
import "dotenv/config";
import { mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { setLogLevel } from "../src/core/log.js";

const arm = (process.argv[2] ?? "on").toLowerCase(); // "on" | "off"
const name = process.argv[3] ?? (arm === "off" ? "ab-off" : "ab-on");

setLogLevel("info");
process.env.CHORALE_PLAN_EXEC = "1";
process.env.CHORALE_SMOKE_RUN = "1";
if (arm === "off") process.env.CHORALE_NO_CONTRACT = "1";

const PROMPT =
  "Build BookmarkHub, a small fullstack web app, in this directory. Backend: Node + Express + TypeScript using better-sqlite3 for storage and JWT for auth; endpoints for register, login, and full CRUD of bookmarks (fields: title, url, tags) scoped to the authenticated user. Frontend: a minimal single-page app (plain HTML/JS or React) that registers, logs in, and lists/creates/deletes bookmarks by calling the backend API. Provide a runnable start script for the backend and a short README. Make it actually run.";

(async () => {
  const origCwd = process.cwd();
  const config = loadConfig();
  config.agents.dir = resolve(origCwd, config.agents.dir);
  const registry = buildRegistry(config);
  const orchestrator = loadAgent(join(config.agents.dir, "orchestrator.md"));

  const workdir = resolve(origCwd, "experiments", name);
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });

  process.stdout.write(`\n=== A/B build — arm=${arm} contract-first=${arm !== "off"} → ${workdir} ===\n`);
  process.chdir(workdir);
  const started = Date.now();
  try {
    const res = await runAgent({ config, registry, agent: orchestrator, prompt: PROMPT, permissionMode: "full-auto", stream: false });
    process.chdir(origCwd);
    process.stdout.write(`\n=== arm=${arm} finished in ${Math.round((Date.now() - started) / 1000)}s · final text ${res.text.length} chars ===\n`);
  } catch (e) {
    process.chdir(origCwd);
    process.stdout.write(`\n=== arm=${arm} FAILED: ${e instanceof Error ? e.stack : String(e)} ===\n`);
    process.exitCode = 1;
  }
})();

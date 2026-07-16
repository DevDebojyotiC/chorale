/**
 * Scribe benchmark: groundedness (README gen), staleness detection, and edit safety.
 * Usage: npx tsx eval/scribe-bench.ts [ground|stale|edit|all] ["<model>" ...]
 *   (no models → gemma-4-31B + gpt-oss-120B)
 *
 * Groundedness runs an A/B on the groundCheck pass (CHORALE_NO_GROUND) to show its value.
 */
import "dotenv/config";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { checkGroundedness } from "../src/core/ground.js";
import { GROUND, STALE, EDIT, gradeGroundRecall, gradeStaleness, gradeEdit, type FileMap } from "./scribe-fixtures.js";

process.env.CHORALE_NO_LEARN = "1";

const which = process.argv[2] ?? "all";
const rest = process.argv.slice(3);
const models = rest.length ? rest : ["hf:google/gemma-4-31B-it", "fireworks:accounts/fireworks/models/gpt-oss-120b"];

const repoRoot = process.cwd();
const config = loadConfig();
config.agents.dir = resolve(repoRoot, config.agents.dir); // absolute — suites chdir into temp workspaces
const registry = buildRegistry(config);
const scribe = loadAgent(resolve(repoRoot, "agents/scribe.md"));

function makeWorkspace(files: FileMap): string {
  const dir = mkdtempSync(join(tmpdir(), "chorale-scribe-"));
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
  return dir;
}

async function runIn(dir: string, prompt: string, model: string, mode: "read-only" | "full-auto"): Promise<string> {
  try {
    process.chdir(dir);
    const res = await runAgent({ config, registry, agent: scribe, prompt, modelOverride: model, permissionMode: mode, stream: false });
    return res.text;
  } finally {
    process.chdir(repoRoot);
  }
}

async function ground(model: string): Promise<void> {
  for (const useGround of [false, true]) {
    process.env.CHORALE_NO_GROUND = useGround ? "0" : "1";
    let invented = 0, covered = 0, total = 0;
    for (const f of GROUND) {
      const dir = makeWorkspace(f.files);
      try {
        await runIn(dir, "Write a README.md for this project. Document only what exists.", model, "full-auto");
        const readme = existsSync(join(dir, "README.md")) ? readFileSync(join(dir, "README.md"), "utf8") : "";
        invented += checkGroundedness(["README.md"], dir).length;
        const r = gradeGroundRecall(readme, f.expect);
        covered += r.covered.length; total += f.expect.length;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    process.stdout.write(`  GROUND ${useGround ? "+groundCheck" : "single-pass "} · invented refs ${invented} · recall ${covered}/${total}\n`);
  }
}

async function stale(model: string): Promise<void> {
  let caught = 0, total = 0;
  for (const f of STALE) {
    const dir = makeWorkspace(f.files);
    try {
      const text = await runIn(dir, `The project is in the current directory. Read ${f.target}, package.json, and the source files, then list everything in ${f.target} that no longer matches the code — renamed/removed symbols, dead links, and wrong version numbers.`, model, "read-only");
      const g = gradeStaleness(text, f.planted);
      caught += g.caught.length; total += f.planted.length;
      process.stdout.write(`  STALE ${f.id} · ${g.caught.length}/${f.planted.length}${g.missed.length ? ` (missed ${g.missed.join(",")})` : ""}\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  process.stdout.write(`  STALE total · ${caught}/${total}\n`);
}

async function edit(model: string): Promise<void> {
  for (const f of EDIT) {
    const dir = makeWorkspace({ [f.file]: f.content });
    try {
      await runIn(dir, `Fix the grammar and spelling in ${f.file}. Do not change any technical facts (numbers, names, ports).`, model, "full-auto");
      const edited = existsSync(join(dir, f.file)) ? readFileSync(join(dir, f.file), "utf8") : "";
      const g = gradeEdit(edited, f);
      process.stdout.write(`  EDIT ${f.id} · ${g.ok ? "✓" : "✗"}${g.typosLeft.length ? ` typos left: ${g.typosLeft.join(",")}` : ""}${g.factsDropped.length ? ` FACTS DROPPED: ${g.factsDropped.join(",")}` : ""}\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

for (const model of models) {
  process.stdout.write(`\n===== scribe · ${model} =====\n`);
  if (which === "all" || which === "ground") await ground(model);
  if (which === "all" || which === "stale") await stale(model);
  if (which === "all" || which === "edit") await edit(model);
}
process.exit(0);

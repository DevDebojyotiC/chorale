/**
 * Validate the tiered foundational repair (Phase 4 · escalate-last) against a REAL broken build.
 *
 * The LedgerLite stress run produced a backend with no server entry point: code in backend/, a
 * package.json pointing at a nonexistent src/index.js, routers defined but never mounted. The old
 * repair fed all 7 issues to the coder at once and even escalation couldn't produce the one fix that
 * matters. This harness runs the NEW tiered loop (foundational issues first, in isolation, with a
 * focused "create the entry that mounts every router" directive) against that exact build — real
 * coder/research/escalate calls + the global playbook — and reports whether it becomes runnable and
 * what got written back (self-learn).
 *
 *   npx tsx eval/runnable-repair.ts [path-to-project]
 */
import "dotenv/config";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { resolveModelPlan } from "../src/core/model-policy.js";
import { runRepairLadder } from "../src/core/repair.js";
import { getPlaybook } from "../src/core/playbook.js";
import { ensureSeeded } from "../src/core/playbook-seed.js";
import { checkRunnable, tiersOf, directiveFor, type RunnableIssue } from "../src/core/runnable.js";
import { setLogLevel } from "../src/core/log.js";

setLogLevel("debug");
process.env.CHORALE_TRACE = "1";
process.env.CHORALE_NO_REVIEW_GATE = "1";
process.env.CHORALE_NO_CRITIQUE = "1";
process.env.CHORALE_NO_GATES = "1";

const say = (s: string): void => void process.stdout.write(s + "\n");
const SKIP = new Set(["node_modules", ".git", "dist", "data", "build", ".next", "coverage"]);
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function collect(root: string): { files: { path: string; content: string }[]; paths: Set<string> } {
  const files: { path: string; content: string }[] = [];
  const paths = new Set<string>();
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const abs = join(dir, name);
      const r = rel ? rel + "/" + name : name;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else {
        paths.add(r);
        if (CODE.test(name) || name === "package.json" || name === ".env" || name === ".env.example") {
          try {
            files.push({ path: r, content: readFileSync(abs, "utf8") });
          } catch {
            /* skip unreadable */
          }
        }
      }
    }
  };
  walk(root, "");
  return { files, paths };
}

const origCwd = process.cwd();
const config = loadConfig();
config.agents.dir = resolve(origCwd, config.agents.dir);
const registry = buildRegistry(config);
const coderModel = resolveModelPlan(loadAgent(join(config.agents.dir, "coder.md")), config).model;
const escalateModel = resolveModelPlan(loadAgent(join(config.agents.dir, "coder.md")), config).fallbacks[0];

const cwd = resolve(origCwd, process.argv[2] ?? "experiments/ledgerlite");
const allIssues = (): RunnableIssue[] => {
  const { files, paths } = collect(cwd);
  return checkRunnable(files, paths);
};

const runSpecialist = async (agentName: string, task: string, escalate: boolean): Promise<{ ok: boolean; text: string }> => {
  const spec = loadAgent(join(config.agents.dir, `${agentName}.md`));
  const modelOverride = escalate ? resolveModelPlan(spec, config).fallbacks[0] : undefined;
  if (modelOverride) say(`  ⤴ escalating ${agentName} → ${modelOverride}`);
  try {
    const res = await runAgent({ config, registry, agent: spec, prompt: task, modelOverride, permissionMode: "full-auto", stream: true });
    return { ok: true, text: res.text };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) };
  }
};
const researchDelegate = async ({ issues }: { issues: string[] }): Promise<string> => {
  const r = await runSpecialist("research", `A build is not runnable and the known fixes did not resolve it. Investigate and return concrete guidance the coder can apply. Do NOT write files.\n\nIssues:\n- ${issues.join("\n- ")}`, false);
  return r.ok ? r.text : "";
};

const pb = getPlaybook();
ensureSeeded(pb);
const learnedBefore = pb.entries().filter((e) => e.source !== "seeded").length;

say(`\n${"═".repeat(78)}\n  TIERED RUNNABILITY REPAIR — LIVE\n${"═".repeat(78)}`);
say(`  project:  ${cwd}`);
say(`  cheap:    ${coderModel}\n  escalate: ${escalateModel}`);
const initial = allIssues();
say(`\n  initial issues (${initial.length}) grouped into ${tiersOf(initial).length} tier(s):`);
tiersOf(initial).forEach((t, i) => say(`    tier ${i}: ${t.map((x) => x.kind).join(", ")}`));
say(`${"─".repeat(78)}`);

process.chdir(cwd);
for (let pass = 0; pass < 4; pass++) {
  const issues = allIssues();
  if (issues.length === 0) break;
  const tier = tiersOf(issues)[0]!;
  const tierKinds = new Set(tier.map((i) => i.kind));
  const { text: directive, note } = directiveFor(tier, issues, collect(cwd).files);
  const tierMessages = tier.map((i, idx) => i.message + (directive && idx === 0 ? "\n\n" + directive : ""));
  const fingerprint = (): string => {
    let h = 5381;
    for (const f of collect(cwd).files.sort((a, b) => a.path.localeCompare(b.path))) {
      const s = f.path + "\0" + f.content;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return String(h >>> 0);
  };
  say(`\n${"·".repeat(4)} TIER [${[...tierKinds].join("/")}]${note ? " —" + note.replace(/^\s*\(|\)\s*$/g, "") : ""} ${"·".repeat(20)}`);
  const r = await runRepairLadder(tierMessages, {
    attempt: ({ instruction, escalate }) => runSpecialist("coder", instruction, escalate),
    recheck: () => allIssues().filter((i) => tierKinds.has(i.kind)).map((i) => i.message),
    fingerprint,
    model: coderModel,
    escalateModel,
    kind: "runnability",
    hasResearch: true,
    research: researchDelegate,
    canEscalate: true,
    project: "ledgerlite",
    step: "runnability",
    log: (m) => say(`  ↳ ${m}`),
  });
  say(`  tier result: ${r.solved ? "cleared" : "still failing"} via ${r.rungs.map((x) => x.level).join("→")}`);
  if (!r.solved && allIssues().some((i) => tierKinds.has(i.kind))) {
    say(`  ⚠ could not clear the ${[...tierKinds].join("/")} tier — stopping`);
    break;
  }
}
process.chdir(origCwd);

const remaining = allIssues();
const learned = pb.entries().filter((e) => e.source !== "seeded");
say(`\n${"═".repeat(78)}\n  RESULT\n${"═".repeat(78)}`);
say(`  runnable now:   ${remaining.length === 0 ? "YES ✓" : "NO — " + remaining.length + " issue(s) remain: " + remaining.map((i) => i.kind).join(", ")}`);
say(`  entry created:  ${collect(cwd).files.some((f) => /\.listen\s*\(/.test(f.content)) ? "YES ✓ (a file now calls .listen())" : "no"}`);
say(`  learned (self-learn): ${learned.length - learnedBefore} new entry(ies) this run, ${learned.length} total`);
for (const e of learned.slice(-4)) say(`    • [${e.source}] ${e.title.slice(0, 66)}`);
say(`${"═".repeat(78)}`);

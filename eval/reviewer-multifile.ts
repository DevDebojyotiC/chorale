/**
 * Multi-file cross-contract review: bugs that only manifest ACROSS files — a caller
 * that violates a callee's contract (wrong argument order, a field the producer
 * doesn't return, an unawaited async result). Each fixture is a tiny project written
 * to a temp dir; the reviewer must READ the files (its read/ls/glob tools) and reason
 * across them. Graded by signature terms; the grader is validated in reviewer-selftest.
 *
 * Usage: npx tsx eval/reviewer-multifile.ts ["<provider:model>" ...]
 *   (no args → gemma-4-31B + gpt-oss-120B)
 */
import "dotenv/config";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { gradeReview, type Fixture } from "./reviewer-fixtures.js";
import { MULTIFILE } from "./reviewer-suites.js";

process.env.CHORALE_NO_LEARN = "1";
process.env.CHORALE_NO_CRITIQUE = "1"; // raw single-pass base measurement

const DEFAULT_MODELS = ["hf:google/gemma-4-31B-it", "fireworks:accounts/fireworks/models/gpt-oss-120b"];
const models = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_MODELS;
const repoRoot = process.cwd();
const config = loadConfig();
const registry = buildRegistry(config);
const reviewer = loadAgent(resolve(repoRoot, "agents/reviewer.md"));

async function runModel(modelRef: string): Promise<void> {
  process.stdout.write(`\n===== MULTIFILE · ${modelRef} =====\n`);
  let caught = 0, totalDefects = 0, goodClean = 0, cleanN = 0;
  const t0 = Date.now();
  for (const f of MULTIFILE) {
    const dir = mkdtempSync(join(tmpdir(), "chorale-mf-"));
    for (const [name, content] of Object.entries(f.files)) writeFileSync(join(dir, name), content);
    const fileList = Object.keys(f.files).join(", ");
    let text = "";
    try {
      process.chdir(dir);
      const res = await runAgent({
        config, registry, agent: reviewer,
        prompt: `Review this small project for correctness and security. Read every file in the current directory (${fileList}) and check that the files are consistent with each other. Report findings in your exact format and end with a VERDICT.`,
        modelOverride: modelRef, permissionMode: "read-only", stream: false,
      });
      text = res.text;
    } finally {
      process.chdir(repoRoot);
      rmSync(dir, { recursive: true, force: true });
    }
    const g = gradeReview(f as unknown as Fixture, text);
    if (f.clean) {
      cleanN++;
      const ok = g.falseBlockers === 0;
      if (ok) goodClean++;
      process.stdout.write(`  ${f.id.padEnd(18)} ${ok ? "✓ no false alarm" : `✗ ${g.falseBlockers} false BLOCKER/MAJOR`}  [${g.verdict ?? "—"}]\n`);
    } else {
      caught += g.caught.length;
      totalDefects += f.defects.length;
      process.stdout.write(`  ${f.id.padEnd(18)} ${g.missed.length === 0 ? "✓" : "✗ MISSED"}  [${g.verdict ?? "—"}]\n`);
    }
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  process.stdout.write(`  ── cross-file recall ${caught}/${totalDefects} · precision ${goodClean}/${cleanN} clean · ${secs}s\n`);
}

for (const m of models) await runModel(m);
process.exit(0);

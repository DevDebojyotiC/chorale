/**
 * Chorale-Coder cross-model benchmark.
 *
 * Runs the coder agent (with the verify-repair harness) on a fixed coding task
 * across several models, each in an isolated temp workspace, and scores every run
 * on three axes:
 *   1. wrote    — did it actually create a file?
 *   2. syntax   — does the file pass syntax verification?
 *   3. works    — does the app FUNCTION? (headless jsdom: add a task, check DOM + localStorage)
 *
 * Usage:  npx tsx eval/coder-bench.ts
 * Needs HF_TOKEN / FIREWORKS_API_KEY in .env for the serverless models.
 */
import "dotenv/config";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { verifyFiles } from "../src/core/verify.js";

const PROMPT =
  "Create a folder demo-todo with a single self-contained index.html: a to-do list app to add and " +
  "remove tasks, tasks persist in localStorage, modern CSS legible in light AND dark themes, vanilla " +
  "JS all inline. Then tell me the path.";

const MODELS = [
  { label: "Qwen2.5-7B (HF)", ref: "hf:Qwen/Qwen2.5-7B-Instruct" },
  { label: "gpt-oss-120B (FW)", ref: "fireworks:accounts/fireworks/models/gpt-oss-120b" },
  { label: "GLM-5.2 (FW)", ref: "fireworks:accounts/fireworks/models/glm-5p2" },
  { label: "Kimi-K2 (FW)", ref: "fireworks:accounts/fireworks/models/kimi-k2p6" },
];
const TIMEOUT_MS = 240_000;

function findHtml(dir: string): string | null {
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    const p = String(entry);
    if (extname(p).toLowerCase() === ".html") return p.split("\\").join("/");
  }
  return null;
}

async function functionalTest(html: string): Promise<{ ok: boolean; note: string }> {
  try {
    const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/", pretendToBeVisual: true });
    await new Promise((r) => setTimeout(r, 120)); // let DOMContentLoaded / onload wire up
    const doc = dom.window.document;
    const input = doc.querySelector('input[type="text"], input:not([type]), input') as HTMLInputElement | null;
    const addBtn = [...doc.querySelectorAll("button")].find((b) => /add|\+|new/i.test(b.textContent || "")) as
      | HTMLButtonElement
      | undefined;
    if (!input || !addBtn) {
      dom.window.close();
      return { ok: false, note: "no input/add button found" };
    }
    const before = doc.querySelectorAll("li").length;
    input.value = "Eval task 42";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    addBtn.click();
    await new Promise((r) => setTimeout(r, 40));
    const after = doc.querySelectorAll("li").length;
    const rendered = /Eval task 42/.test(doc.body.textContent || "");
    const persisted = (dom.window.localStorage?.length ?? 0) > 0;
    dom.window.close();
    const ok = (after > before || rendered) && persisted;
    return { ok, note: `li ${before}→${after}, shown=${rendered}, persisted=${persisted}` };
  } catch (e) {
    return { ok: false, note: `jsdom: ${e instanceof Error ? e.message : String(e)}`.slice(0, 60) };
  }
}

function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | "TIMEOUT"> {
  return Promise.race([p, new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), ms))]);
}

interface Row {
  model: string;
  wrote: boolean;
  syntax: boolean;
  works: boolean;
  tokens: string;
  secs: string;
  note: string;
}

const repoRoot = process.cwd();
const config = loadConfig();
const registry = buildRegistry(config);
const coder = loadAgent(resolve(repoRoot, "agents/coder.md"));

const rows: Row[] = [];
for (const m of MODELS) {
  process.stderr.write(`\n\n========== ${m.label} (${m.ref}) ==========\n`);
  const ws = mkdtempSync(join(tmpdir(), "chorale-bench-"));
  const started = Date.now();
  const row: Row = { model: m.label, wrote: false, syntax: false, works: false, tokens: "-", secs: "-", note: "" };
  try {
    process.chdir(ws);
    const res = await raceTimeout(
      runAgent({ config, registry, agent: coder, prompt: PROMPT, modelOverride: m.ref, permissionMode: "full-auto", stream: false }),
      TIMEOUT_MS,
    );
    process.chdir(repoRoot);
    if (res === "TIMEOUT") {
      row.note = "timed out";
    } else {
      const usage = res.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      row.tokens = usage ? `${usage.inputTokens ?? "?"}/${usage.outputTokens ?? "?"}` : "-";
      const rel = findHtml(ws);
      if (rel) {
        row.wrote = true;
        row.syntax = (await verifyFiles([rel], ws)).length === 0;
        const fn = await functionalTest(readFileSync(join(ws, rel), "utf8"));
        row.works = fn.ok;
        row.note = fn.note;
      } else {
        row.note = "no .html written";
      }
    }
  } catch (e) {
    process.chdir(repoRoot);
    row.note = `error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 60);
  } finally {
    try {
      rmSync(ws, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  row.secs = ((Date.now() - started) / 1000).toFixed(0);
  rows.push(row);
}

const yn = (b: boolean) => (b ? "✓" : "✗");
console.log("\n\n=== CHORALE-CODER CROSS-MODEL BENCHMARK — todo app (verify-repair on) ===\n");
console.log("model               | wrote | syntax | works | tok in/out   | secs | note");
console.log("--------------------|-------|--------|-------|--------------|------|-----------------------------");
for (const r of rows) {
  console.log(
    `${r.model.padEnd(19)} |   ${yn(r.wrote)}   |   ${yn(r.syntax)}    |   ${yn(r.works)}   | ${r.tokens.padEnd(12)} | ${r.secs.padStart(4)} | ${r.note}`,
  );
}
process.exit(0);

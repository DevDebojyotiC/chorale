/**
 * Scribe multi-format benchmark: does the agent actually CREATE, READ, and CONVERT
 * real document formats? Graded objectively by round-trip — produce a file, read it
 * back with the document tools, check the content survived.
 *
 * Usage: npx tsx eval/scribe-formats.ts [write|read|convert|all] ["<model>" ...]
 */
import "dotenv/config";
import { mkdtempSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildRegistry } from "../src/core/model-registry.js";
import { loadAgent } from "../src/agents/loader.js";
import { runAgent } from "../src/core/runtime.js";
import { createDocumentTools } from "../src/tools/documents.js";

process.env.CHORALE_NO_LEARN = "1";

const which = process.argv[2] ?? "all";
const rest = process.argv.slice(3);
const models = rest.length ? rest : ["hf:google/gemma-4-31B-it", "fireworks:accounts/fireworks/models/gpt-oss-120b"];

const repoRoot = process.cwd();
const config = loadConfig();
config.agents.dir = resolve(repoRoot, config.agents.dir);
const registry = buildRegistry(config);
const scribe = loadAgent(resolve(repoRoot, "agents/scribe.md"));

function ws(): string {
  return mkdtempSync(join(tmpdir(), "chorale-fmt-"));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function docTools(dir: string): any {
  return createDocumentTools({ mode: "full-auto", cwd: dir });
}
async function readBack(dir: string, path: string): Promise<string> {
  const r = await docTools(dir).read_doc.execute({ path }, {});
  return r.content ?? "";
}
async function run(dir: string, prompt: string, model: string, mode: "read-only" | "full-auto"): Promise<string> {
  try {
    process.chdir(dir);
    const res = await runAgent({ config, registry, agent: scribe, prompt, modelOverride: model, permissionMode: mode, stream: false });
    return res.text;
  } finally {
    process.chdir(repoRoot);
  }
}

interface Task {
  id: string;
  setup?: (dir: string) => void | Promise<void>;
  prompt: string;
  mode: "read-only" | "full-auto";
  check: (dir: string, answer: string) => Promise<boolean>;
}

const WRITE: Task[] = [
  {
    id: "write-xlsx",
    prompt: "Create a spreadsheet sales.xlsx with columns Product and Units, and two rows: Widget 120, Gadget 85.",
    mode: "full-auto",
    check: async (d) => { const c = existsSync(join(d, "sales.xlsx")) ? await readBack(d, "sales.xlsx") : ""; return c.includes("Widget") && c.includes("120"); },
  },
  {
    id: "write-docx",
    prompt: "Create a Word document report.docx titled 'Report' with a paragraph stating revenue was 8080 this quarter.",
    mode: "full-auto",
    check: async (d) => { const c = existsSync(join(d, "report.docx")) ? await readBack(d, "report.docx") : ""; return c.includes("Report") && c.includes("8080"); },
  },
  {
    id: "write-pdf",
    prompt: "Create a PDF summary.pdf titled 'Summary' that mentions the figure 42.",
    mode: "full-auto",
    check: async (d) => { const c = existsSync(join(d, "summary.pdf")) ? await readBack(d, "summary.pdf") : ""; return c.includes("Summary") && c.includes("42"); },
  },
  {
    id: "write-pptx",
    prompt: "Create a PowerPoint deck.pptx with a slide titled 'Overview' and a bullet saying the product launched in July.",
    mode: "full-auto",
    check: async (d) => { const c = existsSync(join(d, "deck.pptx")) ? await readBack(d, "deck.pptx") : ""; return c.includes("Overview") && c.toLowerCase().includes("july"); },
  },
];

const READ: Task[] = [
  {
    id: "read-xlsx",
    setup: async (d) => { await docTools(d).write_sheet.execute({ path: "people.xlsx", rows: [["Name", "Age"], ["Ada", 36]] }, {}); },
    prompt: "Read people.xlsx and tell me Ada's age.",
    mode: "read-only",
    check: async (_d, a) => a.includes("36"),
  },
  {
    id: "read-pdf",
    setup: async (d) => { await docTools(d).write_doc.execute({ path: "doc.pdf", content: "# Config\n\nThe server listens on port 9090." }, {}); },
    prompt: "Read doc.pdf and tell me which port the server listens on.",
    mode: "read-only",
    check: async (_d, a) => a.includes("9090"),
  },
  {
    id: "read-docx",
    setup: async (d) => { await docTools(d).write_doc.execute({ path: "spec.docx", content: "# Spec\n\nThe auth token is ABC999." }, {}); },
    prompt: "Read spec.docx and tell me the auth token.",
    mode: "read-only",
    check: async (_d, a) => a.includes("ABC999"),
  },
  {
    id: "read-image-ocr",
    setup: (d) => { copyFileSync(resolve(repoRoot, "test/fixtures/ocr-sample.png"), join(d, "shot.png")); },
    prompt: "Read the text in the image shot.png and tell me what number it contains.",
    mode: "read-only",
    check: async (_d, a) => a.includes("8080"),
  },
];

const CONVERT: Task[] = [
  {
    id: "convert-md-pdf",
    setup: (d) => writeFileSync(join(d, "notes.md"), "# Notes\n\nBudget is 5000 dollars.\n"),
    prompt: "Convert notes.md to a PDF called notes.pdf.",
    mode: "full-auto",
    check: async (d) => { const c = existsSync(join(d, "notes.pdf")) ? await readBack(d, "notes.pdf") : ""; return c.includes("5000"); },
  },
  {
    id: "convert-csv-xlsx",
    setup: (d) => writeFileSync(join(d, "data.csv"), "Name,Score\nAda,99\n"),
    prompt: "Convert data.csv to an Excel file data.xlsx.",
    mode: "full-auto",
    check: async (d) => { const c = existsSync(join(d, "data.xlsx")) ? await readBack(d, "data.xlsx") : ""; return c.includes("Ada") && c.includes("99"); },
  },
  {
    id: "convert-docx-md",
    setup: async (d) => { await docTools(d).write_doc.execute({ path: "a.docx", content: "# Title\n\nContains marker QQ42." }, {}); },
    prompt: "Convert a.docx to Markdown as a.md.",
    mode: "full-auto",
    check: async (d) => { const c = existsSync(join(d, "a.md")) ? await readBack(d, "a.md") : ""; return c.includes("QQ42"); },
  },
];

const SUITES: Record<string, Task[]> = { write: WRITE, read: READ, convert: CONVERT };
const chosen = which === "all" ? Object.keys(SUITES) : [which];

for (const model of models) {
  process.stdout.write(`\n===== scribe formats · ${model} =====\n`);
  for (const suite of chosen) {
    let pass = 0;
    const tasks = SUITES[suite]!;
    for (const t of tasks) {
      const dir = ws();
      try {
        if (t.setup) await t.setup(dir);
        const answer = await run(dir, t.prompt, model, t.mode);
        const ok = await t.check(dir, answer);
        if (ok) pass++;
        process.stdout.write(`  ${suite.toUpperCase().padEnd(8)} ${t.id.padEnd(18)} ${ok ? "✓" : "✗"}\n`);
      } catch (e) {
        process.stdout.write(`  ${suite.toUpperCase().padEnd(8)} ${t.id.padEnd(18)} ✗ (${e instanceof Error ? e.message.slice(0, 40) : "err"})\n`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    process.stdout.write(`  ── ${suite} ${pass}/${tasks.length}\n`);
  }
}
process.exit(0);

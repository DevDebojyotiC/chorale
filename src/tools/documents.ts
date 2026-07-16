import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { marked } from "marked";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import htmlToDocx from "html-to-docx";
import { PDFParse } from "pdf-parse";
import { buildHtmlDoc, injectCharts, isTheme, type ThemeName } from "./doc-themes.js";
import { resolveInside, rel, type ToolContext } from "./permissions.js";

const MAX_BYTES = 25 * 1024 * 1024; // don't parse absurdly large binaries
const TEXT_MAX = 40000;

/** Image formats we OCR text out of. */
export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".pbm"]);
/** Extensions we can extract text/markdown from. */
export const READABLE_DOC_EXT = new Set([
  ".pdf", ".docx", ".xlsx", ".xlsm", ".pptx", ".csv", ".tsv", ".html", ".htm", ".json", ".md", ".markdown", ".txt", ".yaml", ".yml", ".toml",
  ...IMAGE_EXT,
]);
/** Extensions we can create. */
export const WRITABLE_DOC_EXT = new Set([".pdf", ".docx", ".pptx", ".html", ".htm", ".md", ".markdown", ".txt"]);
/** Sheet formats for write_sheet. */
export const SHEET_EXT = new Set([".xlsx", ".csv", ".tsv"]);
/** Binary doc formats (skipped by the text-oriented groundedness check). */
export const BINARY_DOC_EXT = new Set([".pdf", ".docx", ".xlsx", ".xlsm", ".pptx"]);

async function mdToHtml(md: string, theme: ThemeName = "docs", charts = false): Promise<string> {
  let body = await marked.parse(md);
  if (charts) body = injectCharts(body);
  return buildHtmlDoc(body, theme);
}
function resolveTheme(t: string | undefined): ThemeName {
  return t && isTheme(t) ? t : "docs";
}

/** Strip HTML tags to readable text (lightweight). */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Locate a Chromium-based browser for high-fidelity PDF rendering, or null. */
function findBrowser(): string | null {
  if (process.env.CHORALE_CHROME && existsSync(process.env.CHORALE_CHROME)) return process.env.CHORALE_CHROME;
  const candidates =
    process.platform === "win32"
      ? [
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
          "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
          "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Print an HTML string to a PDF via a headless browser. Returns true on success. */
function printHtmlToPdf(html: string, absOut: string): boolean {
  const browser = findBrowser();
  if (!browser) return false;
  const tmp = join(tmpdir(), `chorale-pdf-${process.pid}-${Buffer.byteLength(html)}.html`);
  writeFileSync(tmp, html, "utf8");
  try {
    const r = spawnSync(
      browser,
      ["--headless", "--disable-gpu", "--no-sandbox", `--print-to-pdf=${absOut}`, "--no-pdf-header-footer", `file://${tmp.replace(/\\/g, "/")}`],
      { timeout: 60000, stdio: "ignore" },
    );
    return existsSync(absOut) && !r.error;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/** pure-JS pdfkit fallback rendering text lines; `markdown` enlarges `#` headings. */
async function pdfkitLines(lines: string[], absOut: string, markdown: boolean): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 54 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => {
      try {
        writeFileSync(absOut, Buffer.concat(chunks));
        resolve();
      } catch (e) {
        reject(e as Error);
      }
    });
    for (const line of lines) {
      const h = markdown ? /^(#{1,6})\s+(.*)/.exec(line) : null;
      if (h) doc.fontSize(20 - h[1]!.length * 2).text(h[2]!).moveDown(0.3).fontSize(11);
      else doc.fontSize(11).text(markdown ? line.replace(/[*_`]/g, "") : line);
    }
    doc.end();
  });
}

/** Render Markdown to a PDF with a theme: headless Chrome/Edge (fidelity) or pdfkit fallback. */
async function mdToPdf(md: string, absOut: string, theme: ThemeName = "docs", charts = false): Promise<{ engine: string }> {
  if (printHtmlToPdf(await mdToHtml(md, theme, charts), absOut)) return { engine: "browser" };
  await pdfkitLines(md.split("\n"), absOut, true);
  return { engine: "pdfkit" };
}

/** Render a raw HTML string to a PDF, preserving its structure/CSS (browser), else text (fallback). */
async function htmlToPdf(html: string, absOut: string): Promise<{ engine: string }> {
  if (printHtmlToPdf(html, absOut)) return { engine: "browser" };
  await pdfkitLines(htmlToText(html).split("\n"), absOut, false);
  return { engine: "pdfkit" };
}

// mammoth ships convertToMarkdown at runtime but omits it from its types.
const mammothMd = (mammoth as unknown as { convertToMarkdown: (o: { buffer: Buffer }) => Promise<{ value: string }> }).convertToMarkdown;

/** DOCX → markdown. */
async function docxToMd(abs: string): Promise<string> {
  const { value } = await mammothMd({ buffer: readFileSync(abs) });
  return value;
}

/** XLSX → markdown tables (one per worksheet). */
async function xlsxToMd(abs: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(abs);
  const out: string[] = [];
  wb.eachSheet((ws) => {
    const rows: string[][] = [];
    ws.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(cell.value == null ? "" : String(cell.value)));
      rows.push(cells);
    });
    if (!rows.length) return;
    out.push(`## ${ws.name}`);
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");
    out.push(`| ${pad(rows[0]!).join(" | ")} |`);
    out.push(`| ${Array(width).fill("---").join(" | ")} |`);
    for (const r of rows.slice(1)) out.push(`| ${pad(r).join(" | ")} |`);
  });
  return out.join("\n");
}

/** PDF → text. */
async function pdfToText(abs: string): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(readFileSync(abs)) });
  const { text } = await parser.getText();
  return text;
}

/** PPTX → text (dynamic import — officeparser is only needed for slides). */
async function pptxToText(abs: string): Promise<string> {
  const { parseOffice } = (await import("officeparser")) as unknown as {
    parseOffice: (p: string) => Promise<{ toText?: () => string; content?: string }>;
  };
  const r = await parseOffice(abs);
  return (typeof r.toText === "function" ? r.toText() : r.content) ?? "";
}

/** Markdown → PPTX: each top-level heading starts a slide; following lines become bullets. */
async function mdToPptx(md: string, absOut: string): Promise<void> {
  const PptxGenJS = (await import("pptxgenjs")).default as unknown as new () => {
    addSlide: () => { addText: (text: unknown, opts?: unknown) => void };
    writeFile: (o: { fileName: string }) => Promise<string>;
  };
  const pptx = new PptxGenJS();
  const blocks = md.split(/\n(?=#{1,2}\s)/).filter((b) => b.trim());
  const slides = blocks.length ? blocks : [md];
  for (const block of slides) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const title = lines[0]!.replace(/^#{1,6}\s*/, "").replace(/[*_`]/g, "");
    const slide = pptx.addSlide();
    slide.addText(title, { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, bold: true });
    const bullets = lines.slice(1).map((l) => l.replace(/^[-*+]\s*/, "").replace(/[*_`#]/g, "")).filter(Boolean);
    if (bullets.length) {
      slide.addText(
        bullets.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
        { x: 0.7, y: 1.3, w: 8.5, h: 5, fontSize: 16 },
      );
    }
  }
  await pptx.writeFile({ fileName: absOut });
}

/** Image → text via OCR (dynamic import — tesseract.js is heavy and rarely needed). */
async function imageToText(abs: string): Promise<string> {
  type Rec = (img: string, lang: string) => Promise<{ data: { text: string } }>;
  const mod = (await import("tesseract.js")) as unknown as { recognize?: Rec; default?: { recognize?: Rec } };
  const recognize = mod.recognize ?? mod.default?.recognize;
  if (!recognize) throw new Error("tesseract.js recognize() unavailable");
  const { data } = await recognize(abs, "eng");
  return data.text;
}

function csvEscape(v: unknown, sep: string): string {
  const s = v == null ? "" : String(v);
  return /["\n\r]|[,;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s.includes(sep) ? `"${s}"` : s;
}

/** Build the document tools for a permission context. */
export function createDocumentTools(ctx: ToolContext): ToolSet {
  const { cwd } = ctx;

  const read_doc = tool({
    description:
      "Extract text/markdown from a document: PDF, DOCX, XLSX, CSV/TSV, HTML, JSON, YAML, TOML, or Markdown. " +
      "Use this (not `read`) for binary/office formats.",
    inputSchema: z.object({ path: z.string().describe("Workspace-relative document path") }),
    execute: async ({ path }) => {
      try {
        const abs = resolveInside(cwd, path);
        if (!existsSync(abs)) return { error: `not found: ${path}` };
        if (statSync(abs).size > MAX_BYTES) return { error: `file too large to parse (> ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` };
        const ext = extname(abs).toLowerCase();
        let content: string;
        if (ext === ".pdf") content = await pdfToText(abs);
        else if (ext === ".docx") content = await docxToMd(abs);
        else if (ext === ".xlsx" || ext === ".xlsm") content = await xlsxToMd(abs);
        else if (ext === ".pptx") content = await pptxToText(abs);
        else if (IMAGE_EXT.has(ext)) content = await imageToText(abs);
        else if (ext === ".html" || ext === ".htm") content = htmlToText(readFileSync(abs, "utf8"));
        else content = readFileSync(abs, "utf8"); // csv/tsv/json/yaml/toml/md/txt
        ctx.reads?.push(content.slice(0, TEXT_MAX));
        return { path: rel(cwd, abs), format: ext.slice(1) || "txt", content: content.slice(0, TEXT_MAX), truncated: content.length > TEXT_MAX };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const write_doc = tool({
    description:
      "Create a document from Markdown content. The output format is chosen by the extension: .pdf, .docx, .html, or .md/.txt. " +
      "Optional `theme` styles HTML/PDF/DOCX output: 'report' (presentation-grade, gradient cover) · 'docs' (clean, default) · 'minimal'.",
    inputSchema: z.object({
      path: z.string(),
      content: z.string().describe("Markdown source for the document"),
      theme: z.string().optional().describe("Theme/profile for HTML/PDF/DOCX: report/docs/minimal/dark, or a topic profile (executive, academic, legal, invoice, resume, clinical, marketing, editorial, recipe, techdoc). Default: docs."),
      charts: z.boolean().optional().describe("Render numeric Markdown tables as inline bar charts (default: false)"),
    }),
    execute: async ({ path, content, theme, charts }) => {
      try {
        const abs = resolveInside(cwd, path);
        const ext = extname(abs).toLowerCase();
        if (!WRITABLE_DOC_EXT.has(ext)) return { error: `unsupported write format "${ext}" — use .pdf, .docx, .html, or .md` };
        mkdirSync(dirname(abs), { recursive: true });
        const th = resolveTheme(theme);
        const ch = charts === true;
        let engine = ext.slice(1);
        if (ext === ".pdf") engine = (await mdToPdf(content, abs, th, ch)).engine;
        else if (ext === ".docx") {
          const buf = await htmlToDocx(await mdToHtml(content, th, ch));
          writeFileSync(abs, Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer));
        } else if (ext === ".pptx") await mdToPptx(content, abs);
        else if (ext === ".html" || ext === ".htm") writeFileSync(abs, await mdToHtml(content, th, ch), "utf8");
        else writeFileSync(abs, content, "utf8");
        ctx.touched?.add(rel(cwd, abs));
        return { path: rel(cwd, abs), format: ext.slice(1), theme: th, engine };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const write_sheet = tool({
    description: "Create a spreadsheet (.xlsx) or delimited file (.csv/.tsv) from a 2D array of rows (the first row is the header).",
    inputSchema: z.object({
      path: z.string(),
      rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe("Array of rows; each row an array of cells"),
    }),
    execute: async ({ path, rows }) => {
      try {
        const abs = resolveInside(cwd, path);
        const ext = extname(abs).toLowerCase();
        if (!SHEET_EXT.has(ext)) return { error: `unsupported sheet format "${ext}" — use .xlsx, .csv, or .tsv` };
        mkdirSync(dirname(abs), { recursive: true });
        if (ext === ".xlsx") {
          const wb = new ExcelJS.Workbook();
          const ws = wb.addWorksheet("Sheet1");
          for (const r of rows) ws.addRow(r);
          await wb.xlsx.writeFile(abs);
        } else {
          const sep = ext === ".tsv" ? "\t" : ",";
          writeFileSync(abs, rows.map((r) => r.map((c) => csvEscape(c, sep)).join(sep)).join("\n") + "\n", "utf8");
        }
        ctx.touched?.add(rel(cwd, abs));
        return { path: rel(cwd, abs), format: ext.slice(1), rows: rows.length };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const convert = tool({
    description:
      "Convert a file to another format in one step: e.g. report.md → report.pdf, notes.docx → notes.md, data.csv → data.xlsx. " +
      "Preserves the content; picks the right reader/writer from the extensions. Optional `theme` ('report'/'docs'/'minimal') " +
      "styles Markdown→HTML/PDF/DOCX output. An HTML source is rendered as-is (its own styling wins).",
    inputSchema: z.object({
      from: z.string(),
      to: z.string(),
      theme: z.string().optional().describe("Theme/profile for HTML/PDF/DOCX: report/docs/minimal/dark, or a topic profile (executive, academic, legal, invoice, resume, clinical, marketing, editorial, recipe, techdoc). Default: docs."),
      charts: z.boolean().optional().describe("Render numeric Markdown tables as inline bar charts (default: false)"),
    }),
    execute: async ({ from, to, theme, charts }) => {
      try {
        const src = resolveInside(cwd, from);
        const dst = resolveInside(cwd, to);
        if (!existsSync(src)) return { error: `source not found: ${from}` };
        const fromExt = extname(src).toLowerCase();
        const toExt = extname(dst).toLowerCase();
        mkdirSync(dirname(dst), { recursive: true });

        // Sheet ↔ sheet (csv/tsv/xlsx) keeps tabular structure.
        if (SHEET_EXT.has(fromExt) && SHEET_EXT.has(toExt)) {
          const rows = await readSheetRows(src, fromExt);
          if (toExt === ".xlsx") {
            const wb = new ExcelJS.Workbook();
            const ws = wb.addWorksheet("Sheet1");
            for (const r of rows) ws.addRow(r);
            await wb.xlsx.writeFile(dst);
          } else {
            const sep = toExt === ".tsv" ? "\t" : ",";
            writeFileSync(dst, rows.map((r) => r.map((c) => csvEscape(c, sep)).join(sep)).join("\n") + "\n", "utf8");
          }
          ctx.touched?.add(rel(cwd, dst));
          return { from: rel(cwd, src), to: rel(cwd, dst), rows: rows.length };
        }

        // HTML source: render it FAITHFULLY (structure + CSS), don't flatten to text first.
        if (fromExt === ".html" || fromExt === ".htm") {
          const rawHtml = readFileSync(src, "utf8");
          let engine = toExt.slice(1);
          if (toExt === ".pdf") engine = (await htmlToPdf(rawHtml, dst)).engine;
          else if (toExt === ".docx") {
            const buf = await htmlToDocx(rawHtml);
            writeFileSync(dst, Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer));
          } else if (toExt === ".html" || toExt === ".htm") writeFileSync(dst, rawHtml, "utf8");
          else if (WRITABLE_DOC_EXT.has(toExt)) writeFileSync(dst, htmlToText(rawHtml), "utf8"); // md/txt = extracted text
          else return { error: `unsupported conversion target "${toExt}"` };
          ctx.touched?.add(rel(cwd, dst));
          return { from: rel(cwd, src), to: rel(cwd, dst), engine };
        }

        // Otherwise go through markdown/text.
        let md: string;
        if (fromExt === ".pdf") md = await pdfToText(src);
        else if (fromExt === ".docx") md = await docxToMd(src);
        else if (fromExt === ".xlsx" || fromExt === ".xlsm") md = await xlsxToMd(src);
        else if (fromExt === ".html" || fromExt === ".htm") md = htmlToText(readFileSync(src, "utf8"));
        else md = readFileSync(src, "utf8");

        const th = resolveTheme(theme);
        const ch = charts === true;
        let engine = toExt.slice(1);
        if (toExt === ".pdf") engine = (await mdToPdf(md, dst, th, ch)).engine;
        else if (toExt === ".docx") {
          const buf = await htmlToDocx(await mdToHtml(md, th, ch));
          writeFileSync(dst, Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer));
        } else if (toExt === ".html" || toExt === ".htm") writeFileSync(dst, await mdToHtml(md, th, ch), "utf8");
        else if (WRITABLE_DOC_EXT.has(toExt)) writeFileSync(dst, md, "utf8");
        else return { error: `unsupported conversion target "${toExt}"` };
        ctx.touched?.add(rel(cwd, dst));
        return { from: rel(cwd, src), to: rel(cwd, dst), engine };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  return { read_doc, write_doc, write_sheet, convert };
}

async function readSheetRows(abs: string, ext: string): Promise<(string | number)[][]> {
  if (ext === ".xlsx") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(abs);
    const ws = wb.worksheets[0];
    const rows: (string | number)[][] = [];
    ws?.eachRow((row) => {
      const cells: (string | number)[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(cell.value == null ? "" : (cell.value as string | number)));
      rows.push(cells);
    });
    return rows;
  }
  const sep = ext === ".tsv" ? "\t" : ",";
  return readFileSync(abs, "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.length)
    .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, "")));
}

/** Names of document tools that only read (available in every permission mode). */
export const READ_ONLY_DOC_TOOLS = new Set(["read_doc"]);
/** Names of document tools that write files (omitted in read-only mode). */
export const WRITE_DOC_TOOLS = new Set(["write_doc", "write_sheet", "convert"]);

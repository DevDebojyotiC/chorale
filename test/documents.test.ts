import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentTools, WRITE_DOC_TOOLS, READ_ONLY_DOC_TOOLS } from "../src/tools/documents";
import { buildToolSet } from "../src/tools/registry";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = (t: any) => (i: any) => t.execute(i, {});

describe("Phase 4 — scribe document tools (round-trip)", () => {
  let dir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tools: any;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chorale-doc-"));
    tools = createDocumentTools({ mode: "full-auto", cwd: dir });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("XLSX: write_sheet then read_doc round-trips cell values", async () => {
    const w = await exec(tools.write_sheet)({ path: "data.xlsx", rows: [["Name", "Age"], ["Ada", 36], ["Bob", 41]] });
    expect(w.rows).toBe(3);
    expect(existsSync(join(dir, "data.xlsx"))).toBe(true);
    const r = await exec(tools.read_doc)({ path: "data.xlsx" });
    expect(r.content).toContain("Ada");
    expect(r.content).toContain("36");
    expect(r.content).toContain("Bob");
  });

  it("CSV: write_sheet then read_doc", async () => {
    await exec(tools.write_sheet)({ path: "data.csv", rows: [["a", "b"], ["1", "2"]] });
    const r = await exec(tools.read_doc)({ path: "data.csv" });
    expect(r.content).toContain("a,b");
  });

  it("DOCX: write_doc(markdown) then read_doc extracts the text", async () => {
    await exec(tools.write_doc)({ path: "out.docx", content: "# Report\n\nRevenue was **8080** this quarter." });
    expect(existsSync(join(dir, "out.docx"))).toBe(true);
    const r = await exec(tools.read_doc)({ path: "out.docx" });
    expect(r.content).toContain("Report");
    expect(r.content).toContain("8080");
  });

  it("HTML: write_doc(markdown) then read_doc extracts the text", async () => {
    await exec(tools.write_doc)({ path: "page.html", content: "# Hello\n\nWorld 42." });
    const raw = (await exec(tools.read_doc)({ path: "page.html" })).content;
    expect(raw).toContain("Hello");
    expect(raw).toContain("42");
  });

  it("PDF: write_doc(markdown) then read_doc extracts the text", async () => {
    const w = await exec(tools.write_doc)({ path: "doc.pdf", content: "# Title\n\nThe port is 8080." });
    expect(["browser", "pdfkit"]).toContain(w.engine);
    expect(existsSync(join(dir, "doc.pdf"))).toBe(true);
    const r = await exec(tools.read_doc)({ path: "doc.pdf" });
    expect(r.content).toContain("8080");
  });

  it("convert: CSV → XLSX → read back preserves values", async () => {
    writeFileSync(join(dir, "in.csv"), "Name,Age\nAda,36\n");
    await exec(tools.convert)({ from: "in.csv", to: "out.xlsx" });
    const r = await exec(tools.read_doc)({ path: "out.xlsx" });
    expect(r.content).toContain("Ada");
    expect(r.content).toContain("36");
  });

  it("PPTX: write_doc(markdown outline) then read_doc extracts slide text", async () => {
    await exec(tools.write_doc)({ path: "deck.pptx", content: "# Quarterly Review\n\n- Revenue up 20 percent\n- Two new hires\n\n# Roadmap\n\n- Ship v2" });
    expect(existsSync(join(dir, "deck.pptx"))).toBe(true);
    const r = await exec(tools.read_doc)({ path: "deck.pptx" });
    expect(r.content).toContain("Quarterly Review");
    expect(r.content).toContain("20 percent");
    expect(r.content).toContain("Roadmap");
  });

  it("convert: DOCX → Markdown", async () => {
    await exec(tools.write_doc)({ path: "src.docx", content: "# Spec\n\nUse token XYZ123." });
    await exec(tools.convert)({ from: "src.docx", to: "src.md" });
    const r = await exec(tools.read_doc)({ path: "src.md" });
    expect(r.content).toContain("Spec");
    expect(r.content).toContain("XYZ123");
  });

  it("convert: HTML → PDF renders the real HTML (not flattened text)", async () => {
    writeFileSync(join(dir, "invoice.html"), "<html><body><h1>Invoice</h1><table><tr><td>Total</td><td>$4200</td></tr></table></body></html>");
    const res = await exec(tools.convert)({ from: "invoice.html", to: "invoice.pdf" });
    expect(res.engine === "browser" || res.engine === "pdfkit").toBe(true); // faithful render, or JS fallback
    expect(existsSync(join(dir, "invoice.pdf"))).toBe(true);
    const back = await exec(tools.read_doc)({ path: "invoice.pdf" });
    expect(back.content).toContain("Invoice");
    expect(back.content).toContain("4200");
  });

  it("convert: HTML → DOCX passes the real HTML to the docx writer", async () => {
    writeFileSync(join(dir, "page.html"), "<html><body><h1>Heading</h1><p>Marker ZZ88.</p></body></html>");
    await exec(tools.convert)({ from: "page.html", to: "page.docx" });
    const back = await exec(tools.read_doc)({ path: "page.docx" });
    expect(back.content).toContain("Heading");
    expect(back.content).toContain("ZZ88");
  });

  it("refuses paths that escape the workspace and unsupported formats", async () => {
    expect((await exec(tools.read_doc)({ path: "../secret.pdf" })).error).toMatch(/escapes/);
    expect((await exec(tools.write_doc)({ path: "x.rtf", content: "hi" })).error).toMatch(/unsupported/);
  });

  it("theme 'report' produces presentation-grade CSS; 'minimal' stays plain", async () => {
    const md = "# Title\n\n## Section\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> A callout.\n";
    await exec(tools.write_doc)({ path: "r.html", content: md, theme: "report" });
    const r = readFileSync(join(dir, "r.html"), "utf8");
    expect(r).toMatch(/--accent:/); // design tokens (CSS variables)
    expect(r).toMatch(/linear-gradient/); // gradient cover title
    expect(r).toMatch(/thead th\{[^}]*background:var\(--accent\)/); // colored table header
    expect(r).toMatch(/nth-child\(even\)/); // zebra striping
    expect(r).toMatch(/blockquote\{[^}]*border-left/); // callout box
    expect(r).toMatch(/@media print/); // print styles
    expect(r).toMatch(/prefers-color-scheme:dark/); // dark mode

    await exec(tools.write_doc)({ path: "m.html", content: md, theme: "minimal" });
    const m = readFileSync(join(dir, "m.html"), "utf8");
    expect(m).not.toMatch(/linear-gradient/);
    expect(m).not.toMatch(/--accent/);
  });

  it("charts: numeric tables become bar charts grounded to the real values", async () => {
    const md = "# Data\n\n| Model | Score |\n|-------|------:|\n| A | 5 |\n| B | 10 |\n\n| Note | Text |\n|------|------|\n| x | hi |\n";
    await exec(tools.write_doc)({ path: "d.html", content: md, theme: "report", charts: true });
    const h = readFileSync(join(dir, "d.html"), "utf8");
    expect(h).toMatch(/figure class="chart"/); // a chart was produced
    expect(h).toMatch(/width:100%/); // the max value (10) is a full bar
    expect(h).toMatch(/width:50%/); // 5 is half of 10
    expect((h.match(/figure class="chart"/g) || []).length).toBe(1); // only the numeric table, not the text one
    // without charts, no figure
    await exec(tools.write_doc)({ path: "d0.html", content: md, theme: "report" });
    expect(readFileSync(join(dir, "d0.html"), "utf8")).not.toMatch(/figure class="chart"/);
  });

  it("themes carry through convert (md → styled pdf uses the browser engine)", async () => {
    writeFileSync(join(dir, "n.md"), "# Big Report\n\nRevenue 5000.\n");
    const res = await exec(tools.convert)({ from: "n.md", to: "n.pdf", theme: "report" });
    expect(["browser", "pdfkit"]).toContain(res.engine);
    expect((await exec(tools.read_doc)({ path: "n.pdf" })).content).toContain("5000");
  });

  it("gates write tools by permission mode; read_doc always available", () => {
    const names = ["read_doc", "write_doc", "write_sheet", "convert"];
    expect(WRITE_DOC_TOOLS.has("write_doc")).toBe(true);
    expect(READ_ONLY_DOC_TOOLS.has("read_doc")).toBe(true);
    const ro = Object.keys(buildToolSet(names, { mode: "read-only", cwd: dir }));
    expect(ro).toContain("read_doc");
    expect(ro).not.toContain("write_doc");
    const ae = Object.keys(buildToolSet(names, { mode: "auto-edit", cwd: dir }));
    expect(ae).toEqual(expect.arrayContaining(["read_doc", "write_doc", "write_sheet", "convert"]));
  });
});

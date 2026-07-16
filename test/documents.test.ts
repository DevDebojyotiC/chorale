import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
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

  it("convert: DOCX → Markdown", async () => {
    await exec(tools.write_doc)({ path: "src.docx", content: "# Spec\n\nUse token XYZ123." });
    await exec(tools.convert)({ from: "src.docx", to: "src.md" });
    const r = await exec(tools.read_doc)({ path: "src.md" });
    expect(r.content).toContain("Spec");
    expect(r.content).toContain("XYZ123");
  });

  it("refuses paths that escape the workspace and unsupported formats", async () => {
    expect((await exec(tools.read_doc)({ path: "../secret.pdf" })).error).toMatch(/escapes/);
    expect((await exec(tools.write_doc)({ path: "x.rtf", content: "hi" })).error).toMatch(/unsupported/);
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

import { describe, it, expect } from "vitest";
import { parseTextToolCalls, extractCodeBlocks, inferFilename, ensureExports } from "../src/core/tool-call-salvage";

const KNOWN = new Set(["write", "edit", "read", "bash"]);

describe("Phase 2 — tool-call salvage", () => {
  it("recovers a JSON tool call a model wrote as text (the qwen2.5-coder case)", () => {
    const text = '{"name": "write", "arguments": {"content": "export const toRoman = (n) => { return \\"X\\"; };"}}';
    const calls = parseTextToolCalls(text, KNOWN);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("write");
    expect(String(calls[0]?.args.content)).toContain("toRoman");
  });

  it("recovers a call wrapped in <tool_call> tags", () => {
    const text = 'Sure!\n<tool_call>\n{"name":"write","args":{"path":"a.js","content":"1"}}\n</tool_call>';
    const calls = parseTextToolCalls(text, KNOWN);
    expect(calls[0]?.name).toBe("write");
    expect(calls[0]?.args.path).toBe("a.js");
  });

  it("recovers a call inside a ```tool fence with parameters key", () => {
    const text = '```tool\n{"tool":"read","parameters":{"path":"x.txt"}}\n```';
    const calls = parseTextToolCalls(text, KNOWN);
    expect(calls[0]?.name).toBe("read");
    expect(calls[0]?.args.path).toBe("x.txt");
  });

  it("ignores JSON that isn't a known tool call", () => {
    expect(parseTextToolCalls('{"symbol":"M","value":1000}', KNOWN)).toHaveLength(0);
    expect(parseTextToolCalls('{"name":"nope","args":{}}', KNOWN)).toHaveLength(0);
  });

  it("does not parse braces inside strings", () => {
    // the content string contains { } but only the outer call should parse
    const text = '{"name":"write","args":{"path":"a.js","content":"const x = { a: 1 };"}}';
    const calls = parseTextToolCalls(text, KNOWN);
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.args.content)).toContain("{ a: 1 }");
  });

  it("recovers a call whose content is a backtick template literal (qwen2.5-coder L2 case)", () => {
    // The model wrapped the write call in a ```json fence AND delimited content
    // with backticks — invalid JSON, defeats strict parsing. Loose scrape recovers it.
    const text =
      '```json\n{\n  "name": "write",\n  "arguments": {\n    "path": "solution.mjs",\n    "content": `\nfunction isBalanced(s) {\n  const stack = [];\n  return stack.length === 0;\n}\nexport { isBalanced };\n`\n  }\n}\n```';
    const calls = parseTextToolCalls(text, KNOWN);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("write");
    expect(calls[0]?.args.path).toBe("solution.mjs");
    expect(String(calls[0]?.args.content)).toContain("function isBalanced");
    expect(String(calls[0]?.args.content)).not.toContain('"name"'); // didn't capture the wrapper
  });

  it("recovers an edit call with backtick old/new strings", () => {
    const text = '{"name":"edit","arguments":{"path":"a.js","old_string":`foo`,"new_string":`bar`}}';
    const calls = parseTextToolCalls(text, KNOWN);
    expect(calls[0]?.name).toBe("edit");
    expect(calls[0]?.args.old_string).toBe("foo");
    expect(calls[0]?.args.new_string).toBe("bar");
  });

  it("extracts fenced code blocks (the phi4-mini case)", () => {
    const text = "Here you go:\n```javascript\nexport function toRoman(n){return 'I';}\n```\nDone.";
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.code).toContain("toRoman");
  });

  it("appends an export when a module declares symbols but exports nothing (the L2 slip)", () => {
    const code = "function isBalanced(s) {\n  return s.length === 0;\n}";
    const fixed = ensureExports(code, "solution.mjs");
    expect(fixed).toContain("export { isBalanced }");
    // idempotent + respectful of existing exports
    expect(ensureExports(fixed, "solution.mjs")).toBe(fixed);
    expect(ensureExports("export const x = 1;", "a.js")).toBe("export const x = 1;");
    expect(ensureExports("module.exports = { y: 1 };", "a.cjs")).toBe("module.exports = { y: 1 };");
    // leaves non-modules and export-less scripts-without-decls alone
    expect(ensureExports("console.log('hi');", "a.mjs")).toBe("console.log('hi');");
    expect(ensureExports("function f(){}", "page.html")).toBe("function f(){}");
  });

  it("exports multiple top-level declarations", () => {
    const fixed = ensureExports("const A = 1;\nclass B {}\nfunction c(){}", "m.mjs");
    expect(fixed).toContain("export { A, B, c }");
  });

  it("infers a filename from the prompt", () => {
    expect(inferFilename("Create a single file named solution.mjs that exports ...")).toBe("solution.mjs");
    expect(inferFilename("build demo-todo/index.html")).toBe("demo-todo/index.html");
    expect(inferFilename("no file here")).toBeNull();
  });
});

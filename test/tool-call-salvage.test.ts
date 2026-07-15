import { describe, it, expect } from "vitest";
import { parseTextToolCalls, extractCodeBlocks, inferFilename } from "../src/core/tool-call-salvage";

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

  it("extracts fenced code blocks (the phi4-mini case)", () => {
    const text = "Here you go:\n```javascript\nexport function toRoman(n){return 'I';}\n```\nDone.";
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.code).toContain("toRoman");
  });

  it("infers a filename from the prompt", () => {
    expect(inferFilename("Create a single file named solution.mjs that exports ...")).toBe("solution.mjs");
    expect(inferFilename("build demo-todo/index.html")).toBe("demo-todo/index.html");
    expect(inferFilename("no file here")).toBeNull();
  });
});

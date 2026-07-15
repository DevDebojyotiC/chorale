import { describe, it, expect } from "vitest";
import { createTagStripper, TOOL_MARKUP_TOKENS } from "../src/core/stream-filter";

/** Feed a full string through the stripper in fixed-size chunks and collect output. */
function run(input: string, chunk: number, tokens = TOOL_MARKUP_TOKENS): string {
  const s = createTagStripper(tokens);
  let out = "";
  for (let i = 0; i < input.length; i += chunk) out += s.push(input.slice(i, i + chunk));
  out += s.flush();
  return out;
}

describe("Phase 2 — stream tag stripper", () => {
  it("removes a stray closing tag within one chunk", () => {
    expect(run("The answer is 42.</tool_call>", 1000)).toBe("The answer is 42.");
  });

  it("removes tags split across delta boundaries (char-by-char)", () => {
    expect(run("Hello </tool_call>world", 1)).toBe("Hello world");
    expect(run("a<tool_call>b", 1)).toBe("ab");
  });

  it("is invariant to chunk size", () => {
    const input = "x</tool_call>y<tool_response>z</tool_response> done";
    const expected = "xyz done";
    for (const size of [1, 2, 3, 5, 13, 1000]) {
      expect(run(input, size)).toBe(expected);
    }
  });

  it("leaves normal text (including lone angle brackets) untouched", () => {
    expect(run("if a < b and c > d then", 3)).toBe("if a < b and c > d then");
  });

  it("emits a never-completed partial tag on flush", () => {
    // "</tool" never closes into a real token, so it should survive.
    expect(run("done </tool", 2)).toBe("done </tool");
  });
});

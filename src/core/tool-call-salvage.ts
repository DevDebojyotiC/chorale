/**
 * Content-level tool-call salvage.
 *
 * Small/local models (e.g. qwen2.5-coder, phi4-mini via Ollama) often DON'T emit
 * native structured tool calls — they write the call as JSON text, wrap it in
 * <tool_call> tags, or just dump a fenced code block. The AI SDK's native loop
 * ignores all of that, so nothing executes. These pure parsers let the runtime
 * recover those calls from the model's text and run them itself.
 */

export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** Extract top-level, balanced JSON objects from a string (string-aware). */
function extractJsonObjects(s: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j]!;
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') {
        inStr = true;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            const o: unknown = JSON.parse(s.slice(i, j + 1));
            if (o && typeof o === "object" && !Array.isArray(o)) out.push(o as Record<string, unknown>);
          } catch {
            /* not valid JSON */
          }
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Parse tool calls a model wrote as TEXT. Handles bare JSON, ```tool/```json
 * fences, and <tool_call>…</tool_call> tags (the JSON inside is found either way).
 * Only returns calls whose name is a known tool.
 */
export function parseTextToolCalls(text: string, known: Set<string>): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  const seen = new Set<string>();
  for (const obj of extractJsonObjects(text)) {
    const name = obj.name ?? obj.tool ?? obj.tool_name;
    const args = obj.arguments ?? obj.args ?? obj.parameters ?? obj.input;
    if (typeof name === "string" && known.has(name) && args && typeof args === "object" && !Array.isArray(args)) {
      const key = name + JSON.stringify(args);
      if (!seen.has(key)) {
        seen.add(key);
        calls.push({ name, args: args as Record<string, unknown> });
      }
    }
  }
  return calls;
}

/** Fenced code blocks: ```lang\n…\n``` */
export function extractCodeBlocks(text: string): Array<{ lang: string; code: string }> {
  const out: Array<{ lang: string; code: string }> = [];
  for (const m of text.matchAll(/```([\w.+-]*)\r?\n([\s\S]*?)```/g)) {
    out.push({ lang: (m[1] ?? "").trim(), code: (m[2] ?? "").trim() });
  }
  return out;
}

/** Best-effort filename referenced in a prompt (e.g. "solution.mjs", "index.html"). */
export function inferFilename(prompt: string): string | null {
  const m = prompt.match(/\b([\w.\-/]+\.(?:mjs|cjs|jsx?|tsx?|html?|css|json5?|py|md|txt|sh|ya?ml))\b/i);
  return m?.[1] ?? null;
}

/**
 * Some models (e.g. Qwen via OpenAI-compatible endpoints) leak tool-call markup
 * like `</tool_call>` into the text stream when the endpoint only partially
 * parses their tool calls. This is a small streaming sanitizer that strips a set
 * of literal markup tokens from the text as it streams — correctly handling
 * tokens that are split across delta boundaries.
 */

/** Markup tokens that weak/OSS models sometimes leak into content. */
export const TOOL_MARKUP_TOKENS = [
  "<tool_call>",
  "</tool_call>",
  "<|tool_call|>",
  "<|/tool_call|>",
  "<tool_response>",
  "</tool_response>",
];

export interface TagStripper {
  /** Feed a stream delta; returns the sanitized text that is safe to emit now. */
  push(delta: string): string;
  /** Emit any buffered remainder at end-of-stream. */
  flush(): string;
}

/**
 * Create a stateful stripper that removes any of `tokens` from streamed text.
 * It holds back only the minimal suffix that could be the start of a token
 * spanning into the next delta, so output lag is at most one partial token.
 */
export function createTagStripper(tokens: string[]): TagStripper {
  const active = tokens.filter((t) => t.length > 0);

  const stripComplete = (s: string): string => {
    for (const tok of active) s = s.split(tok).join("");
    return s;
  };

  /** Longest suffix of `s` that is a proper prefix of some token. */
  const heldSuffixLen = (s: string): number => {
    let hold = 0;
    for (const tok of active) {
      const max = Math.min(tok.length - 1, s.length);
      for (let k = max; k > hold; k--) {
        if (s.endsWith(tok.slice(0, k))) {
          hold = k;
          break;
        }
      }
    }
    return hold;
  };

  let buffer = "";

  return {
    push(delta: string): string {
      buffer = stripComplete(buffer + delta);
      const hold = heldSuffixLen(buffer);
      const emit = buffer.slice(0, buffer.length - hold);
      buffer = buffer.slice(buffer.length - hold);
      return emit;
    },
    flush(): string {
      const out = stripComplete(buffer);
      buffer = "";
      return out;
    },
  };
}

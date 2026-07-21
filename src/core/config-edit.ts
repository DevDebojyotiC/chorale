/**
 * Targeted edits to chorale.config.json5 that PRESERVE its comments and formatting.
 *
 * The config is heavily commented on purpose (it doubles as the reference), so we never parse →
 * mutate → re-serialize (that would strip every comment). Instead we locate the exact block and
 * rewrite just the lines we own — the same approach init.ts already uses for profiles.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** Byte range of the body inside a top-level `key: { … }` block (excluding the braces). */
function blockBody(text: string, key: string): { start: number; end: number } | null {
  const re = new RegExp(`(^|\\n)[ \\t]*${key}[ \\t]*:[ \\t]*\\{`);
  const m = re.exec(text);
  if (!m) return null;
  const open = text.indexOf("{", m.index + m[0].length - 1);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { start: open + 1, end: i };
    }
  }
  return null;
}

/** Indentation of the first `key:` line in a block body, so inserts match the file's style. */
function indentOf(body: string): string {
  return /^([ \t]+)\S/m.exec(body)?.[1] ?? "    ";
}

/**
 * Split a trailing `// comment` off a line so rewriting the value keeps the comment.
 * Quote-aware, so the `//` inside a value like "https://…" is not mistaken for a comment.
 */
function trailingComment(text: string): string {
  const line = text.slice(text.lastIndexOf("\n") + 1); // comments live on the LAST line of a match
  let inString = false;
  let quote = "";
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i]!;
    if (inString) {
      if (c === "\\") i++;
      else if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      quote = c;
    } else if (c === "/" && line[i + 1] === "/") {
      return " " + line.slice(i);
    }
  }
  return "";
}

/** Replace a `key: …` line inside `body`, preserving indentation and any trailing comment. */
function replaceKeyLine(body: string, re: RegExp, newCode: string): string | null {
  const m = re.exec(body);
  if (!m) return null;
  const indent = /^[ \t]*/.exec(m[0])![0];
  const rebuilt = `${indent}${newCode}${trailingComment(m[0])}`;
  return body.slice(0, m.index) + rebuilt + body.slice(m.index + m[0].length);
}

/**
 * Set the default model chain: `base.model` = chain[0], `base.fallbacks` = the rest.
 * Pure text transform so it can be unit-tested without touching disk.
 */
export function applyBaseChain(text: string, chain: string[]): string {
  if (chain.length === 0) throw new Error("The default model chain needs at least one model.");
  const blk = blockBody(text, "base");
  if (!blk) throw new Error("Could not find a `base: { … }` block in the config.");

  let body = text.slice(blk.start, blk.end);
  const ind = indentOf(body);
  const [primary, ...fallbacks] = chain;
  const modelLine = `model: ${JSON.stringify(primary)},`;
  const fbLine = `fallbacks: [${fallbacks.map((f) => JSON.stringify(f)).join(", ")}],`;

  // `model:` — replace in place (keeping any trailing comment), or prepend if somehow absent.
  const modelRe = /^[ \t]*model[ \t]*:.*$/m;
  body = replaceKeyLine(body, modelRe, modelLine) ?? `\n${ind}${modelLine}${body}`;

  // `fallbacks: [...]` — may span lines; replace through the closing bracket (+ optional comma).
  const fbRe = /^[ \t]*fallbacks[ \t]*:[ \t]*\[[\s\S]*?\][ \t]*,?/m;
  const withFb = replaceKeyLine(body, fbRe, fbLine);
  body = withFb ?? replaceKeyLine(body, modelRe, `${modelLine}\n${ind}${fbLine}`)!;

  return text.slice(0, blk.start) + body + text.slice(blk.end);
}

/** Persist a new default model chain, keeping the rest of the file verbatim. */
export function setBaseChain(configPath: string, chain: string[]): void {
  writeFileSync(configPath, applyBaseChain(readFileSync(configPath, "utf8"), chain), "utf8");
}

/** Set one scalar inside a top-level `block: { … }` (numbers/booleans/strings), preserving comments. */
export function applyScalar(text: string, block: string, key: string, value: number | boolean | string): string {
  const blk = blockBody(text, block);
  if (!blk) throw new Error(`Could not find a \`${block}: { … }\` block in the config.`);
  let body = text.slice(blk.start, blk.end);
  const ind = indentOf(body);
  const line = `${key}: ${typeof value === "string" ? JSON.stringify(value) : String(value)},`;
  const re = new RegExp(`^[ \\t]*${key}[ \\t]*:.*$`, "m");
  body = replaceKeyLine(body, re, line) ?? `\n${ind}${line}${body}`;
  return text.slice(0, blk.start) + body + text.slice(blk.end);
}

/** Convenience for the `defaults` block. */
export const applyDefault = (text: string, key: string, value: number | boolean | string): string => applyScalar(text, "defaults", key, value);

export function setConfigScalar(configPath: string, block: string, key: string, value: number | boolean | string): void {
  writeFileSync(configPath, applyScalar(readFileSync(configPath, "utf8"), block, key, value), "utf8");
}

export function setDefault(configPath: string, key: string, value: number | boolean | string): void {
  setConfigScalar(configPath, "defaults", key, value);
}

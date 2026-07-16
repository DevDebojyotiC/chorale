/**
 * Deterministic design-quality benchmark: score the presentation richness of an HTML
 * document on the same feature checklist used to compare scribe vs Claude's report.
 * Renders a sample through each scribe theme and (optionally) scores a reference file.
 *
 * Usage: npx tsx eval/scribe-design.ts [path/to/reference.html]
 */
import { readFileSync, existsSync } from "node:fs";
import { buildHtmlDoc, THEME_NAMES, type ThemeName } from "../src/tools/doc-themes.js";
import { marked } from "marked";

export interface DesignScore {
  tokens: boolean; // CSS custom properties
  cover: boolean; // gradient cover / hero
  tableHeader: boolean; // colored table header
  zebra: boolean; // striped rows
  callout: boolean; // styled blockquote/callout
  print: boolean; // @media print
  dark: boolean; // dark-mode support
  cssChars: number;
  score: number; // features present / 7
}

export function scoreDesign(html: string): DesignScore {
  const css = (html.match(/<style>[\s\S]*?<\/style>/gi) ?? []).join("\n");
  const has = (re: RegExp) => re.test(html);
  const f = {
    tokens: has(/--[a-z-]+\s*:/i),
    cover: has(/linear-gradient|radial-gradient|class="[^"]*cover|class="[^"]*hero/i),
    tableHeader: has(/thead[\s\S]{0,80}?(background|--accent)/i) || has(/th\s*\{[^}]*background/i),
    zebra: has(/nth-child\(\s*even|nth-child\(\s*odd|:nth-child\(2n/i),
    callout: has(/blockquote[\s\S]{0,60}?border-left|class="[^"]*(callout|note|highlight)/i),
    print: has(/@media\s+print/i),
    dark: has(/prefers-color-scheme\s*:\s*dark|data-theme|class="[^"]*dark/i),
  };
  const score = Object.values(f).filter(Boolean).length;
  return { ...f, cssChars: css.length, score };
}

const SAMPLE = `# Chorale Benchmark Report

## Summary

A tiered evaluation of three models.

| Model | Score | Cost |
|-------|------:|-----:|
| Gemma-4-31B | 9/10 | $0 |
| gpt-oss-120B | 10/10 | $0.013 |

> Key finding: reliability separates the models on hard tasks.

### Details

\`\`\`js
const x = 1;
\`\`\`
`;

const row = (label: string, s: DesignScore): string => {
  const flags = [
    s.tokens ? "tokens" : "",
    s.cover ? "cover" : "",
    s.tableHeader ? "tbl-hdr" : "",
    s.zebra ? "zebra" : "",
    s.callout ? "callout" : "",
    s.print ? "print" : "",
    s.dark ? "dark" : "",
  ].filter(Boolean).join(" ");
  return `  ${label.padEnd(22)} ${s.score}/7  css=${String(s.cssChars).padStart(5)}  [${flags}]`;
};

const body = marked.parse(SAMPLE) as string;
process.stdout.write("\n=== scribe theme design scores (higher = richer) ===\n");
for (const t of THEME_NAMES) process.stdout.write(row(`scribe:${t}`, scoreDesign(buildHtmlDoc(body, t as ThemeName))) + "\n");

const ref = process.argv[2] ?? "docs/engineering-benchmark-report.html";
if (existsSync(ref)) {
  process.stdout.write(`\n=== reference ===\n` + row(ref.split(/[\\/]/).pop()!, scoreDesign(readFileSync(ref, "utf8"))) + "\n");
}

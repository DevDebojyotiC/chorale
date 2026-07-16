/**
 * Deterministic design-quality benchmark: score the presentation richness of an HTML
 * document on the same feature checklist used to compare scribe vs Claude's report.
 * Renders a sample through each scribe theme and (optionally) scores a reference file.
 *
 * Usage: npx tsx eval/scribe-design.ts [path/to/reference.html]
 */
import { readFileSync, existsSync } from "node:fs";
import { buildHtmlDoc, injectCharts, THEME_NAMES, type ThemeName } from "../src/tools/doc-themes.js";
import { marked } from "marked";

export interface DesignScore {
  tokens: boolean; // CSS custom properties
  cover: boolean; // gradient cover / hero
  tableHeader: boolean; // colored table header
  zebra: boolean; // striped rows
  callout: boolean; // styled blockquote/callout/verdict box
  chart: boolean; // data visualization (bar chart)
  print: boolean; // @media print / @page (print-friendly)
  cssChars: number;
  score: number; // features present / 7
  lightSafe: boolean; // no auto dark-mode background (report docs must stay light)
}

export function scoreDesign(html: string): DesignScore {
  const css = (html.match(/<style>[\s\S]*?<\/style>/gi) ?? []).join("\n");
  const has = (re: RegExp) => re.test(html);
  const f = {
    tokens: has(/--[a-z-]+\s*:/i),
    cover: has(/linear-gradient|radial-gradient|class="[^"]*cover|class="[^"]*hero/i),
    tableHeader: has(/thead[\s\S]{0,80}?(background|--accent)/i) || has(/th\s*\{[^}]*background/i),
    zebra: has(/nth-child\(\s*even|nth-child\(\s*odd|:nth-child\(2n/i),
    callout: has(/blockquote[\s\S]{0,90}?border-left|class="[^"]*(callout|note|highlight|verdict|tldr)/i),
    chart: has(/class="[^"]*(bar-fill|bar-row|brow|chart)/i),
    print: has(/@media\s+print|@page/i),
  };
  const score = Object.values(f).filter(Boolean).length;
  // Print-friendly means no automatic dark background.
  const lightSafe = !has(/prefers-color-scheme\s*:\s*dark/i);
  return { ...f, cssChars: css.length, score, lightSafe };
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
    s.chart ? "chart" : "",
    s.print ? "print" : "",
  ].filter(Boolean).join(" ");
  return `  ${label.padEnd(24)} ${s.score}/7  css=${String(s.cssChars).padStart(5)}  ${s.lightSafe ? "light✓" : "DARK✗"}  [${flags}]`;
};

const body = marked.parse(SAMPLE) as string;
const bodyCharted = injectCharts(body);
process.stdout.write("\n=== scribe theme design scores (higher = richer) ===\n");
for (const t of THEME_NAMES) process.stdout.write(row(`scribe:${t}`, scoreDesign(buildHtmlDoc(body, t as ThemeName))) + "\n");
process.stdout.write(row("scribe:report+charts", scoreDesign(buildHtmlDoc(bodyCharted, "report"))) + "\n");

const ref = process.argv[2] ?? "docs/engineering-benchmark-report.html";
if (existsSync(ref)) {
  process.stdout.write(`\n=== reference ===\n` + row(ref.split(/[\\/]/).pop()!, scoreDesign(readFileSync(ref, "utf8"))) + "\n");
}

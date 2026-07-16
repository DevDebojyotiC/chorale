/**
 * Professional HTML themes for the scribe's write_doc/convert output. Deterministic:
 * the same Markdown always yields the same styled, self-contained HTML. Three themes —
 * `minimal` (legacy plain), `docs` (clean professional, the default), `report`
 * (presentation-grade: gradient cover title, design-token colors, styled tables, callouts).
 */

import { PROFILE_CSS, PROFILE_NAMES, type ProfileName } from "./doc-profiles.js";

/** Core themes plus the topic/industry profiles. */
export type ThemeName = "minimal" | "docs" | "report" | "dark" | ProfileName;
const CORE_THEMES: ThemeName[] = ["minimal", "docs", "report", "dark"];
export const THEME_NAMES: ThemeName[] = [...CORE_THEMES, ...PROFILE_NAMES];
export function isTheme(s: string): s is ThemeName {
  return (THEME_NAMES as string[]).includes(s);
}

const MINIMAL = `body{font-family:system-ui,Arial,sans-serif;line-height:1.5;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#111;background:#fff}
pre{background:#f4f4f4;padding:.75rem;overflow:auto}code{font-family:ui-monospace,monospace}
table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.3rem .6rem}`;

// Default palette is LIGHT + print-friendly (white background, dark text). No auto dark-mode:
// documents must not flip to a dark background on a dark-mode system / when printed.
const TOKENS = `:root{--accent:#4f46e5;--accent-2:#7c3aed;--fg:#1f2937;--muted:#6b7280;--bg:#ffffff;--panel:#f7f8fa;--border:#e5e7eb;--radius:10px;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}`;
// Dark palette is opt-in only (theme: "dark").
const TOKENS_DARK = `:root{--accent:#818cf8;--accent-2:#a78bfa;--fg:#e5e7eb;--muted:#9ca3af;--bg:#0f1117;--panel:#171a21;--border:#2a2f3a;--radius:10px;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}`;

const BASE = `*{box-sizing:border-box}
html{background:var(--bg)}
body{font-family:var(--sans);color:var(--fg);background:var(--bg);line-height:1.65;max-width:56rem;margin:0 auto;padding:2.5rem 1.5rem;font-size:16px}
h1,h2,h3{line-height:1.2;font-weight:700}
h2{font-size:1.4rem;margin-top:2.25rem;padding-bottom:.35rem;border-bottom:2px solid var(--border)}
h3{font-size:1.15rem;margin-top:1.75rem}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
hr{border:none;border-top:1px solid var(--border);margin:2rem 0}
em{color:var(--muted)}
table{border-collapse:collapse;width:100%;margin:1.25rem 0;font-size:.94rem;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
thead th{background:var(--accent);color:#fff;text-align:left;padding:.55rem .8rem}
td,th{padding:.5rem .8rem;border-top:1px solid var(--border)}
tbody tr:nth-child(even){background:var(--panel)}
pre{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:1rem;overflow:auto;font-size:.88rem}
code{font-family:var(--mono);background:var(--panel);padding:.12rem .35rem;border-radius:4px;font-size:.9em}
pre code{background:none;padding:0}
blockquote{margin:1.25rem 0;padding:.8rem 1.1rem;background:var(--panel);border-left:4px solid var(--accent);border-radius:0 var(--radius) var(--radius) 0}
blockquote p{margin:.3rem 0}
img{max-width:100%}
figure.chart{margin:1rem 0 1.5rem}
figure.chart figcaption{font-size:.82rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.5rem}
figure.chart .bar-row{display:flex;align-items:center;gap:.6rem;margin:.28rem 0;font-size:.9rem}
figure.chart .bar-label{flex:0 0 10rem;text-align:right;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
figure.chart .bar-track{flex:1;background:var(--panel);border:1px solid var(--border);border-radius:6px;overflow:hidden}
figure.chart .bar-fill{display:block;background:linear-gradient(90deg,var(--accent),var(--accent-2));height:1.15rem;border-radius:6px}
figure.chart .bar-val{flex:0 0 auto;min-width:3rem;color:var(--fg);font-variant-numeric:tabular-nums}
@media print{body{padding:0;max-width:none}thead th,figure.chart .bar-fill{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;

// Presentation extras shared by `report` (light) and `dark`: gradient cover title + accent H2.
const REPORT_EXTRAS = `
body>h1:first-child{font-size:2.4rem;margin:0 0 1.5rem;padding:2rem;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent-2));border-radius:var(--radius)}
h1{font-size:1.9rem;margin-top:2.5rem}
h2{color:var(--accent)}
@media print{body>h1:first-child{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;

// `docs` = plain light title. `report` = light presentation. `dark` = same layout, dark palette (opt-in).
const DOCS = `${TOKENS}\n${BASE}\nh1{font-size:2rem;margin:0 0 1rem}`;
const REPORT = `${TOKENS}\n${BASE}${REPORT_EXTRAS}`;
const DARK = `${TOKENS_DARK}\n${BASE}${REPORT_EXTRAS}`;

const THEMES: Record<ThemeName, string> = { minimal: MINIMAL, docs: DOCS, report: REPORT, dark: DARK, ...PROFILE_CSS };

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, "").trim();
/** First number in a cell, tolerant of $, %, commas, and ratios like "9/10" (takes 9). */
function firstNumber(s: string): number | null {
  const m = stripTags(s).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/**
 * Turn numeric Markdown tables into inline CSS bar charts (grounded — the bars are the
 * real cell values). Appends a <figure class="chart"> after each table that has a clear
 * numeric column; leaves non-numeric tables untouched.
 */
export function injectCharts(html: string): string {
  return html.replace(/<table>[\s\S]*?<\/table>/gi, (table) => {
    const headMatch = table.match(/<thead>[\s\S]*?<\/thead>/i);
    const headers = headMatch ? [...headMatch[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => stripTags(m[1]!)) : [];
    const bodyMatch = table.match(/<tbody>([\s\S]*?)<\/tbody>/i);
    const rows = [...(bodyMatch ? bodyMatch[1]! : table).matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((r) =>
      [...r[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripTags(c[1]!)),
    );
    if (rows.length < 2) return table;
    const ncols = Math.max(...rows.map((r) => r.length));
    // A column is chartable if ≥60% of its body cells are numeric.
    let chartCol = -1;
    for (let c = 0; c < ncols; c++) {
      const numeric = rows.filter((r) => firstNumber(r[c] ?? "") !== null).length;
      if (numeric >= Math.ceil(rows.length * 0.6)) {
        chartCol = c;
        break;
      }
    }
    if (chartCol === -1) return table;
    const labelCol = [...Array(ncols).keys()].find((c) => c !== chartCol) ?? -1;
    const data = rows
      .map((r, i) => ({ label: (labelCol >= 0 ? r[labelCol] : "") || `Row ${i + 1}`, raw: r[chartCol] ?? "", val: firstNumber(r[chartCol] ?? "") }))
      .filter((d): d is { label: string; raw: string; val: number } => d.val !== null);
    if (data.length < 2) return table;
    const max = Math.max(...data.map((d) => Math.abs(d.val))) || 1;
    const title = headers[chartCol] || "value";
    const bars = data
      .map(
        (d) =>
          `<div class="bar-row"><span class="bar-label">${d.label}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, Math.round((Math.abs(d.val) / max) * 100))}%"></span></span><span class="bar-val">${d.raw}</span></div>`,
      )
      .join("");
    return `${table}\n<figure class="chart" aria-label="chart of ${title}"><figcaption>${title}</figcaption>${bars}</figure>`;
  });
}

/** Wrap rendered body HTML in a full, self-contained HTML document with the chosen theme. */
export function buildHtmlDoc(bodyHtml: string, theme: ThemeName = "docs"): string {
  const css = THEMES[theme] ?? THEMES.docs;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>\n${css}\n</style></head><body>\n${bodyHtml}\n</body></html>`;
}

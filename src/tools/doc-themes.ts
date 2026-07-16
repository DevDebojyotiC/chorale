/**
 * Professional HTML themes for the scribe's write_doc/convert output. Deterministic:
 * the same Markdown always yields the same styled, self-contained HTML. Three themes —
 * `minimal` (legacy plain), `docs` (clean professional, the default), `report`
 * (presentation-grade: gradient cover title, design-token colors, styled tables, callouts).
 */

export type ThemeName = "minimal" | "docs" | "report";
export const THEME_NAMES: ThemeName[] = ["minimal", "docs", "report"];
export function isTheme(s: string): s is ThemeName {
  return (THEME_NAMES as string[]).includes(s);
}

const MINIMAL = `body{font-family:system-ui,Arial,sans-serif;line-height:1.5;max-width:52rem;margin:2rem auto;padding:0 1rem}
pre{background:#f4f4f4;padding:.75rem;overflow:auto}code{font-family:ui-monospace,monospace}
table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.3rem .6rem}`;

const TOKENS = `:root{--accent:#4f46e5;--accent-2:#7c3aed;--fg:#1f2937;--muted:#6b7280;--bg:#ffffff;--panel:#f7f8fa;--border:#e5e7eb;--radius:10px;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
@media (prefers-color-scheme:dark){:root{--fg:#e5e7eb;--muted:#9ca3af;--bg:#0f1117;--panel:#171a21;--border:#2a2f3a}}`;

const BASE = `*{box-sizing:border-box}
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
@media print{body{padding:0;max-width:none}thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;

// `docs` = tokens + base with a plain title. `report` adds a gradient cover title + accent H2.
const DOCS = `${TOKENS}\n${BASE}\nh1{font-size:2rem;margin:0 0 1rem}`;

const REPORT = `${TOKENS}\n${BASE}
body>h1:first-child{font-size:2.4rem;margin:0 0 1.5rem;padding:2rem;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent-2));border-radius:var(--radius)}
h1{font-size:1.9rem;margin-top:2.5rem}
h2{color:var(--accent)}
@media print{body>h1:first-child{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;

const THEMES: Record<ThemeName, string> = { minimal: MINIMAL, docs: DOCS, report: REPORT };

/** Wrap rendered body HTML in a full, self-contained HTML document with the chosen theme. */
export function buildHtmlDoc(bodyHtml: string, theme: ThemeName = "docs"): string {
  const css = THEMES[theme] ?? THEMES.docs;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>\n${css}\n</style></head><body>\n${bodyHtml}\n</body></html>`;
}

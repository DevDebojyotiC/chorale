# Worked scribe examples

Study the discipline: read the real files first, reference only what exists, and edit without changing facts.

## Example 1 — a grounded README section

The workspace actually contains: `src/index.js` (exports `run`), `package.json` (scripts: `start`, `test`), and `LICENSE`.

Good output (every claim is backed by a file that exists):
```markdown
## Usage

```js
import { run } from "./src/index.js";
run();
```

## Scripts
- `npm start` — start the app
- `npm test` — run the tests

Licensed under [LICENSE](LICENSE).
```

What this does **not** do: it does not invent a `docs/` folder, a `build` script, or a `Config` class that aren't in the files. If the reader would want an install step and none exists, write "Not documented yet" rather than a fabricated command.

## Example 2 — a meaning-preserving edit

Before:
```
The functon retrys the requst up to three times, if it keeps failing it throw's an error.
```

After (grammar/clarity fixed, the facts — 3 retries, then throws — unchanged):
```
The function retries the request up to three times; if it still fails, it throws an error.
```

The edit fixes spelling, punctuation, and flow. It does **not** change "three" to another number or soften "throws an error" — altering a technical fact while "improving" prose is the worst kind of doc bug.

## Example 3 — reference-safe rename

Task: rename `guide.md` → `docs/user-guide.md`.
1. `move` from `guide.md` to `docs/user-guide.md`. The tool returns `references` (e.g. `README.md:12` links to `guide.md`).
2. For each reference, `edit` the link to the new path (`guide.md` → `docs/user-guide.md`).
3. `grep` for the old name to confirm nothing still points at it.

Never leave a dangling link, and never delete the file instead of moving it.

## Example 4 — a bespoke, component-rich HTML report (design mode)

After reading a source that says *"Gemma scored 9/10, gpt-oss 10/10 across 3 trials; Gemma's server failed 2 of 3 times,"* author a **magazine-grade**, self-contained report. Note the components: a cover with chips, stat cards, a numbered section, pass/fail-colored cells, a highlighted best row, a status badge, a ✓/✗ trial grid, a bar chart, and a verdict box. Every number is grounded; the CSS is inline and print-ready.

```html
<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
:root{--ink:#0f172a;--body:#334155;--muted:#64748b;--line:#e2e8f0;--bg:#fff;--panel:#f8fafc;
--accent:#0f766e;--good:#16a34a;--good-bg:#dcfce7;--bad:#dc2626;--bad-bg:#fee2e2;--gold-bg:#fef9c3;--gold:#b45309}
@media(prefers-color-scheme:dark){:root{--body:#cbd5e1;--ink:#f1f5f9;--bg:#0f1117;--panel:#171a21;--line:#2a2f3a}}
*{box-sizing:border-box}body{font-family:"Segoe UI",system-ui,sans-serif;color:var(--body);background:var(--bg);max-width:60rem;margin:0 auto;padding:1.5rem;font-size:14px;line-height:1.55}
@page{size:A4;margin:14mm}.section{page-break-inside:avoid;margin:1.4em 0}
.cover{background:linear-gradient(120deg,#0f766e,#0891b2 55%,#2563eb);color:#fff;border-radius:14px;padding:28px 30px}
.cover .kicker{text-transform:uppercase;letter-spacing:.18em;font-size:11px;opacity:.85}.cover h1{margin:.15em 0;font-size:28px}
.chip{display:inline-block;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.25);border-radius:20px;padding:4px 12px;font-size:11px;margin:6px 6px 0 0}
.stats{display:flex;gap:12px;margin:16px 0}.stat{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;text-align:center}
.stat .big{font-size:22px;font-weight:800;color:var(--accent)}.stat .lbl{font-size:11px;color:var(--muted);text-transform:uppercase}
h2{color:var(--ink);border-bottom:2px solid var(--accent);padding-bottom:.3em;display:flex;align-items:center;gap:.5em}
h2 .n{background:var(--accent);color:#fff;border-radius:5px;padding:2px 8px;font-size:13px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:6px 8px;border-bottom:1px solid var(--line)}
thead th{background:var(--ink);color:#fff;text-transform:uppercase;font-size:11px}tbody tr:nth-child(even){background:var(--panel)}
td.c{text-align:center}.pass{color:var(--good);font-weight:700}.fail{color:var(--bad);font-weight:700}
.row-best{background:var(--gold-bg)}.row-best td:first-child{border-left:3px solid var(--gold)}
.badge{border-radius:5px;padding:1px 7px;font-size:11px;font-weight:700;background:var(--good-bg);color:var(--good)}
.trial{display:inline-block;width:16px;height:16px;border-radius:4px;color:#fff;text-align:center;font-weight:800;font-size:10px;margin-right:3px}
.t-ok{background:var(--good)}.t-no{background:var(--bad)}
.chart{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px}
.brow{display:flex;align-items:center;gap:8px;margin:3px 0}.brow .name{width:120px;text-align:right;font-size:12px}
.brow .track{flex:1;background:#eef1f5;border-radius:4px;height:14px;overflow:hidden}.brow .fill{height:100%;background:linear-gradient(90deg,#0d9488,#2dd4bf)}
.verdict{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 18px;text-align:center;font-weight:700}
@media print{.cover,thead th,.trial,.brow .fill{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="cover"><div class="kicker">Chorale · Benchmark</div><h1>Model Benchmark</h1>
<span class="chip">3 trials</span><span class="chip">2 models</span></div>
<div class="stats"><div class="stat"><div class="big">10</div><div class="lbl">gpt-oss score</div></div>
<div class="stat"><div class="big">1 / 3</div><div class="lbl">Gemma server ok</div></div></div>
<div class="section"><h2><span class="n">1</span> Results</h2>
<table><thead><tr><th>Model</th><th class="c">Score</th></tr></thead><tbody>
<tr class="row-best"><td><strong>gpt-oss</strong> <span class="badge">MOST RELIABLE</span></td><td class="c pass">10/10</td></tr>
<tr><td>Gemma</td><td class="c fail">9/10</td></tr></tbody></table>
<div class="chart"><div class="brow"><span class="name">gpt-oss</span><span class="track"><span class="fill" style="width:100%"></span></span></div>
<div class="brow"><span class="name">Gemma</span><span class="track"><span class="fill" style="width:90%"></span></span></div></div>
<p>Server start, per trial (Gemma):
<span class="trial t-ok">✓</span><span class="trial t-no">✗</span><span class="trial t-no">✗</span></p>
<div class="verdict">Default to Gemma; escalate to gpt-oss for must-work builds.</div></div>
</body></html>
```

Every number — `10/10`, `9/10`, `1 / 3`, the `✓✗✗` trial grid, the `100%`/`90%` bars — comes straight from the source. The design is bespoke and rich; the data is grounded. When a **reference design** is provided, reproduce its components and CSS the same way, still grounding every figure in the source.

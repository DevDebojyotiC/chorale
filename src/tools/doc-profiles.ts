/**
 * Topic/industry design profiles for scribe documents. Each shares one light,
 * print-friendly base (consistency) but swaps palette, type, and signature components
 * so every document reads honestly as its type — an invoice looks like an invoice, a
 * legal doc like a contract, a lab report like a lab report. All are white-background
 * and print-safe (no auto dark-mode).
 */

const SANS = `-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif`;
const SERIF = `Georgia,"Times New Roman",Cambria,serif`;
const MONO = `ui-monospace,"Cascadia Code",Consolas,Menlo,monospace`;

/** Shared base — the "always the same" foundation across all scribe docs. */
const PBASE = `*{box-sizing:border-box}
html{background:var(--bg)}
body{color:var(--fg);background:var(--bg);line-height:1.6;margin:0 auto;max-width:var(--measure,58rem);padding:2.4rem 1.6rem;font-size:15px;font-family:var(--body-font,${SANS})}
h1,h2,h3,h4{color:var(--ink,var(--fg));line-height:1.25;font-family:var(--head-font,inherit)}
h1{font-size:1.9rem;margin:0 0 .6rem}h2{font-size:1.35rem;margin:1.8rem 0 .6rem}h3{font-size:1.1rem;margin:1.3rem 0 .4rem}
p{margin:.6em 0}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
hr{border:none;border-top:1px solid var(--border);margin:1.6rem 0}
ul,ol{padding-left:1.2rem}li{margin:.25em 0}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.92rem;border:1px solid var(--border);border-radius:8px;overflow:hidden}
th,td{padding:.5rem .75rem;text-align:left;border-bottom:1px solid var(--border)}
thead th{background:var(--panel);color:var(--ink,var(--fg));font-weight:700}
tbody tr:last-child td{border-bottom:none}
code{font-family:${MONO};background:var(--panel);padding:.1rem .35rem;border-radius:4px;font-size:.9em}
pre{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:1rem;overflow:auto;font-size:.85rem}
pre code{background:none;padding:0}
.muted{color:var(--muted)}.right{text-align:right}.center{text-align:center}
@page{size:A4;margin:16mm}@media print{body{max-width:none;padding:0}thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;

const build = (vars: string, extra = ""): string => `:root{${vars}}\n${PBASE}\n${extra}`;

// ── A · Formal / print ───────────────────────────────────────────────────────
const EXECUTIVE = build(
  `--fg:#26313f;--ink:#12233b;--muted:#5b6b7f;--accent:#1e3a5f;--accent-2:#b45309;--bg:#ffffff;--panel:#f6f1e6;--border:#e6dcc8;--body-font:${SANS};--head-font:${SERIF};--measure:60rem`,
  `.cover{background:linear-gradient(120deg,#12233b,#1e3a5f);color:#fff;border-radius:12px;padding:2rem 2.2rem;border-bottom:4px solid var(--accent-2)}
.cover h1{color:#fff;margin:.2rem 0}.cover .kicker{text-transform:uppercase;letter-spacing:.16em;font-size:.72rem;opacity:.85;font-family:${SANS}}
.exsum{background:#fff;border:1px solid var(--border);border-left:5px solid var(--accent-2);border-radius:8px;padding:1rem 1.3rem;margin:1.3rem 0}
.exsum h3{color:var(--accent-2);text-transform:uppercase;letter-spacing:.06em;font-size:.85rem;margin:.1rem 0 .5rem;font-family:${SANS}}
h2{border-bottom:2px solid var(--accent);padding-bottom:.25rem;color:var(--accent)}
.exhibit{font-size:.8rem;color:var(--muted);font-style:italic;margin:.2rem 0 1rem}
.pull{font-family:${SERIF};font-size:1.15rem;color:var(--accent);border-left:3px solid var(--accent-2);padding-left:1rem;margin:1.2rem 0}
.bottomline{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:1rem 1.3rem;margin:1.3rem 0;font-weight:600}`,
);

const ACADEMIC = build(
  `--fg:#1a1a1a;--ink:#000;--muted:#555;--accent:#3730a3;--bg:#ffffff;--panel:#f4f4f6;--border:#d7d7dd;--body-font:${SERIF};--head-font:${SERIF};--measure:52rem`,
  `.titleblock{text-align:center;margin:0 0 1.4rem}.titleblock h1{font-size:1.7rem}.titleblock .authors{font-size:1rem;margin:.4rem 0}.titleblock .affil{font-size:.85rem;color:var(--muted);font-style:italic}
.abstract{background:var(--panel);border-radius:6px;padding:1rem 1.4rem;margin:1.2rem auto;max-width:44rem;font-size:.92rem}
.abstract h3{text-transform:uppercase;letter-spacing:.05em;font-size:.85rem;text-align:center;margin:0 0 .5rem}
.twocol{column-count:2;column-gap:1.6rem;text-align:justify;font-size:.92rem}.twocol h2,.twocol h3{column-span:all}
h2{font-size:1.1rem}h2 .n,h3 .n{font-weight:700;margin-right:.4rem}
.figure{border:1px solid var(--border);border-radius:4px;padding:.8rem;margin:.8rem 0;text-align:center;background:var(--panel);break-inside:avoid}
.caption{font-size:.8rem;color:var(--muted);margin-top:.4rem}sup.cite{color:var(--accent);font-weight:600}
.refs{font-size:.82rem;column-count:1}.refs li{margin:.3em 0}`,
);

const LEGAL = build(
  `--fg:#1a1a1a;--ink:#000;--muted:#555;--accent:#1a1a1a;--bg:#ffffff;--panel:#f5f5f5;--border:#cccccc;--body-font:${SERIF};--head-font:${SERIF};--measure:50rem`,
  `body{line-height:1.7}h1{text-align:center;font-size:1.4rem;text-transform:uppercase;letter-spacing:.03em}
.parties{margin:1rem 0;font-size:.95rem}.parties strong{text-transform:uppercase}
.recital{font-style:italic;color:var(--muted);margin:.8rem 0}
ol.clauses{counter-reset:c;padding-left:0;list-style:none}ol.clauses>li{counter-increment:c;margin:.9rem 0;padding-left:2.4rem;position:relative}
ol.clauses>li::before{content:counter(c) ".";position:absolute;left:0;font-weight:700}
ol.clauses ol{counter-reset:s;list-style:none;padding-left:0}ol.clauses ol>li{counter-increment:s;padding-left:2.6rem}ol.clauses ol>li::before{content:counter(c) "." counter(s)}
.defterm{font-weight:700}.defs dt{font-weight:700;margin-top:.5rem}.defs dd{margin:.1rem 0 0 1.4rem}
.sig{display:flex;gap:3rem;margin-top:2.4rem;break-inside:avoid}.sig .block{flex:1}.sig .line{border-top:1px solid #000;margin-top:2.2rem;padding-top:.3rem;font-size:.82rem;color:var(--muted)}
.confidential{text-align:center;letter-spacing:.2em;font-size:.75rem;color:var(--muted);text-transform:uppercase;margin-bottom:1rem}`,
);

// ── B · Structured data ──────────────────────────────────────────────────────
const INVOICE = build(
  `--fg:#243040;--ink:#0f172a;--muted:#64748b;--accent:#0f766e;--bg:#ffffff;--panel:#f6f8f8;--border:#e2e8f0;--body-font:${SANS};--measure:52rem`,
  `.inv-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid var(--accent);padding-bottom:1rem;margin-bottom:1.4rem}
.inv-head .co{font-size:1.15rem;font-weight:800;color:var(--ink)}.inv-head .lbl{text-align:right}.inv-head .lbl h1{color:var(--accent);letter-spacing:.05em;font-size:1.6rem}
.meta-grid{display:flex;gap:2.5rem;margin:1rem 0}.meta-grid .b{font-size:.9rem}.meta-grid .b .h{text-transform:uppercase;font-size:.72rem;color:var(--muted);letter-spacing:.05em;margin-bottom:.2rem}
table td.num,table th.num{text-align:right;font-variant-numeric:tabular-nums}
thead th{background:var(--ink);color:#fff;text-transform:uppercase;font-size:.75rem;letter-spacing:.03em}
.totals{margin-left:auto;width:16rem;margin-top:1rem}.totals .row{display:flex;justify-content:space-between;padding:.35rem 0;font-variant-numeric:tabular-nums}
.totals .grand{border-top:2px solid var(--accent);margin-top:.3rem;padding-top:.5rem;font-weight:800;font-size:1.15rem;color:var(--accent)}
.terms{margin-top:1.6rem;font-size:.85rem;color:var(--muted);border-top:1px solid var(--border);padding-top:.8rem}
.due{display:inline-block;background:var(--panel);border:1px solid var(--accent);color:var(--accent);border-radius:6px;padding:.2rem .7rem;font-weight:700;font-size:.85rem}`,
);

const RESUME = build(
  `--fg:#2b3440;--ink:#111827;--muted:#6b7280;--accent:#0e7490;--bg:#ffffff;--panel:#f3f6f7;--border:#e5e7eb;--body-font:${SANS};--measure:54rem`,
  `.cvhead{border-bottom:2px solid var(--accent);padding-bottom:.8rem;margin-bottom:1rem}.cvhead h1{font-size:2rem;margin:0}.cvhead .role{color:var(--accent);font-weight:600}.cvhead .contact{font-size:.85rem;color:var(--muted);margin-top:.4rem;display:flex;flex-wrap:wrap;gap:.3rem 1rem}
.cvgrid{display:grid;grid-template-columns:1fr 2.1fr;gap:1.8rem}
.side h3,.main h3{text-transform:uppercase;letter-spacing:.06em;font-size:.82rem;color:var(--accent);border-bottom:1px solid var(--border);padding-bottom:.2rem}
.tag{display:inline-block;background:var(--panel);border:1px solid var(--border);border-radius:20px;padding:.15rem .7rem;font-size:.78rem;margin:.2rem .2rem 0 0}
.bar{background:var(--panel);border-radius:4px;height:.5rem;margin:.3rem 0 .6rem;overflow:hidden}.bar>i{display:block;height:100%;background:var(--accent)}
.xp{margin:.7rem 0}.xp .top{display:flex;justify-content:space-between;font-weight:600}.xp .top .date{color:var(--muted);font-weight:400;font-size:.85rem}.xp .org{color:var(--accent);font-size:.9rem}
@media print{.cvgrid{grid-template-columns:1fr 2.1fr}}`,
);

const CLINICAL = build(
  `--fg:#1f2a37;--ink:#0b2540;--muted:#64748b;--accent:#0369a1;--good:#15803d;--bad:#b91c1c;--warn:#b45309;--good-bg:#dcfce7;--bad-bg:#fee2e2;--warn-bg:#fef3c7;--bg:#ffffff;--panel:#f1f6fb;--border:#dbe6f0;--body-font:${SANS};--measure:56rem`,
  `.pt-head{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:1rem 1.3rem;margin-bottom:1.2rem;display:flex;flex-wrap:wrap;gap:.4rem 2rem}
.pt-head .f{font-size:.9rem}.pt-head .f .h{text-transform:uppercase;font-size:.68rem;color:var(--muted);letter-spacing:.05em}
h2{color:var(--accent);border-bottom:1px solid var(--border);padding-bottom:.25rem}
table td.num{text-align:right;font-variant-numeric:tabular-nums}thead th{background:var(--accent);color:#fff;font-size:.78rem;text-transform:uppercase}
.flag{font-weight:800;border-radius:4px;padding:0 .4rem;font-size:.78rem}.flag-h{color:var(--bad);background:var(--bad-bg)}.flag-l{color:var(--warn);background:var(--warn-bg)}.flag-n{color:var(--good)}
tr.abn td{background:#fff7f6}
.interp{background:var(--panel);border-left:4px solid var(--accent);border-radius:0 8px 8px 0;padding:.9rem 1.2rem;margin:1.2rem 0}
.disclaimer{font-size:.78rem;color:var(--muted);border-top:1px solid var(--border);margin-top:1.6rem;padding-top:.7rem}`,
);

// ── C · Editorial / persuasive ───────────────────────────────────────────────
const MARKETING = build(
  `--fg:#312e4a;--ink:#1e1b4b;--muted:#6b7280;--accent:#7c3aed;--accent-2:#ec4899;--bg:#ffffff;--panel:#faf5ff;--border:#ede9fe;--body-font:${SANS};--measure:62rem`,
  `.hero{text-align:center;background:linear-gradient(135deg,#faf5ff,#fdf2f8);border:1px solid var(--border);border-radius:18px;padding:3rem 2rem;margin-bottom:1.6rem}
.hero h1{font-size:2.6rem;line-height:1.1;background:linear-gradient(90deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{font-size:1.15rem;color:var(--muted);max-width:36rem;margin:.8rem auto}
.cta{display:inline-block;background:linear-gradient(90deg,var(--accent),var(--accent-2));color:#fff!important;padding:.7rem 1.6rem;border-radius:30px;font-weight:700;margin-top:.6rem}
.features{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin:1.4rem 0}.feature{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:1.2rem}.feature .ico{font-size:1.6rem}.feature h3{margin:.4rem 0 .2rem}
.statsband{display:flex;justify-content:space-around;background:var(--ink);color:#fff;border-radius:14px;padding:1.4rem;margin:1.4rem 0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.statsband .s .big{font-size:1.8rem;font-weight:800}.statsband .s .l{font-size:.8rem;opacity:.8}
.pricing{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}.tier{border:1px solid var(--border);border-radius:12px;padding:1.3rem;text-align:center}.tier.popular{border:2px solid var(--accent);box-shadow:0 8px 24px rgba(124,58,237,.15)}.tier .price{font-size:2rem;font-weight:800;color:var(--accent)}
@media print{.features,.pricing{grid-template-columns:repeat(3,1fr)}}`,
);

const EDITORIAL = build(
  `--fg:#2b2622;--ink:#1a1613;--muted:#7c6f64;--accent:#b91c1c;--bg:#ffffff;--panel:#f7f2ea;--border:#e7ddcf;--body-font:${SERIF};--head-font:${SERIF};--measure:48rem`,
  `.masthead{border-top:3px solid var(--ink);border-bottom:1px solid var(--border);padding:.6rem 0;margin-bottom:1.4rem;display:flex;justify-content:space-between;align-items:baseline;font-family:${SANS};font-size:.8rem;text-transform:uppercase;letter-spacing:.1em}
h1{font-size:2.4rem;line-height:1.12;letter-spacing:-.5px}.byline{font-family:${SANS};font-size:.82rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:.4rem 0 1.2rem}
.lead::first-letter{float:left;font-size:3.4rem;line-height:.8;padding:.1rem .6rem 0 0;color:var(--accent);font-weight:700}
.pull{font-size:1.4rem;line-height:1.35;color:var(--ink);border-top:2px solid var(--accent);border-bottom:2px solid var(--accent);padding:.8rem 0;margin:1.4rem 0;text-align:center;font-style:italic}
.figure img,.figure{border-radius:4px}.caption{font-family:${SANS};font-size:.78rem;color:var(--muted);margin-top:.3rem}
.foot{font-family:${SANS};font-size:.8rem;color:var(--muted);border-top:1px solid var(--border);margin-top:2rem;padding-top:.8rem}`,
);

const RECIPE = build(
  `--fg:#3a2f28;--ink:#4a2c1a;--muted:#8a7565;--accent:#c2410c;--accent-2:#65a30d;--bg:#ffffff;--panel:#fdf6ec;--border:#eaddc7;--body-font:${SANS};--head-font:${SERIF};--measure:52rem`,
  `h1{color:var(--accent);font-size:2.2rem}
.r-meta{display:flex;flex-wrap:wrap;gap:.6rem;margin:.8rem 0 1.4rem}.r-meta .badge{flex:1 1 0;min-width:5rem;text-align:center;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:.5rem .8rem;font-size:.82rem}.r-meta .badge b{color:var(--accent);display:block;font-size:1rem}
.cook{display:grid;grid-template-columns:1fr 1.7fr;gap:1.6rem}
.ingredients{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:1.1rem 1.3rem}.ingredients h3{color:var(--accent-2);margin-top:0}.ingredients li{list-style:none}.ingredients li::before{content:"○";color:var(--accent);margin-right:.5rem}
.steps{counter-reset:st;list-style:none;padding:0}.steps>li{counter-increment:st;position:relative;padding-left:2.6rem;margin:1rem 0}.steps>li::before{content:counter(st);position:absolute;left:0;top:-.1rem;width:1.8rem;height:1.8rem;background:var(--accent);color:#fff;border-radius:50%;text-align:center;line-height:1.8rem;font-weight:800}
.tip{background:#f0fdf4;border-left:4px solid var(--accent-2);border-radius:0 8px 8px 0;padding:.8rem 1.1rem;margin:1rem 0}
@media print{.cook{grid-template-columns:1fr 1.7fr}}`,
);

// ── D · Technical ────────────────────────────────────────────────────────────
const TECHDOC = build(
  `--fg:#334155;--ink:#0f172a;--muted:#64748b;--accent:#4f46e5;--bg:#ffffff;--panel:#f8fafc;--border:#e2e8f0;--body-font:${SANS};--measure:56rem`,
  `h2{border-bottom:1px solid var(--border);padding-bottom:.3rem}h2,h3{scroll-margin-top:1rem}
.toc{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:.9rem 1.2rem;margin:1rem 0}.toc h3{margin:.1rem 0 .4rem;font-size:.82rem;text-transform:uppercase;color:var(--muted)}.toc a{display:block;padding:.12rem 0;font-size:.9rem}
pre{background:#0f172a;color:#e2e8f0;border:none}pre code{color:inherit}
code{color:#3730a3}
.adm{border-radius:8px;padding:.8rem 1.1rem;margin:1rem 0;border-left:4px solid}.adm .t{font-weight:700;text-transform:uppercase;font-size:.75rem;letter-spacing:.04em}
.adm.info{background:#eff6ff;border-color:#3b82f6}.adm.info .t{color:#1d4ed8}.adm.warn{background:#fffbeb;border-color:#f59e0b}.adm.warn .t{color:#b45309}.adm.tip{background:#f0fdf4;border-color:#22c55e}.adm.tip .t{color:#15803d}
.method{display:inline-block;border-radius:5px;padding:.1rem .55rem;font-weight:800;font-size:.75rem;color:#fff;font-family:${MONO}}.m-get{background:#16a34a}.m-post{background:#2563eb}.m-put{background:#d97706}.m-del{background:#dc2626}
kbd{font-family:${MONO};background:#fff;border:1px solid #cbd5e1;border-bottom-width:2px;border-radius:4px;padding:.05rem .4rem;font-size:.82rem}
table td code{background:var(--panel)}.tag-dep{color:#dc2626;border:1px solid #fecaca;border-radius:4px;padding:0 .4rem;font-size:.72rem}`,
);

export type ProfileName =
  | "executive" | "academic" | "legal" | "invoice" | "resume" | "clinical" | "marketing" | "editorial" | "recipe" | "techdoc";

export const PROFILE_CSS: Record<ProfileName, string> = {
  executive: EXECUTIVE, academic: ACADEMIC, legal: LEGAL, invoice: INVOICE, resume: RESUME,
  clinical: CLINICAL, marketing: MARKETING, editorial: EDITORIAL, recipe: RECIPE, techdoc: TECHDOC,
};
export const PROFILE_NAMES = Object.keys(PROFILE_CSS) as ProfileName[];

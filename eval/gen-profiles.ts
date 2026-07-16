/**
 * Generate one showcase HTML per topic profile, exercising that profile's signature
 * components with representative (light, print-friendly) sample content.
 * Usage: npx tsx eval/gen-profiles.ts   → writes docs/scribe-profile-<name>.html
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildHtmlDoc, type ThemeName } from "../src/tools/doc-themes.js";
import { scoreDesign } from "./scribe-design.js";

const DEMOS: Record<string, string> = {
  executive: `
<div class="cover"><div class="kicker">Strategy Brief · Q3 2026</div><h1>Market Expansion Assessment</h1>
<p style="opacity:.9;margin:.4rem 0 0">A board-level review of entry options for the EU market.</p></div>
<div class="exsum"><h3>Executive Summary</h3><ul><li>The EU opportunity is <strong>$1.2B</strong>, growing 14% annually.</li>
<li>Direct entry maximizes margin but carries the highest execution risk.</li><li>Recommendation: a phased partner-led entry, converting to direct in year 2.</li></ul></div>
<h2>1 · Options Considered</h2><p>Three entry models were evaluated against cost, speed, and control.</p>
<table><thead><tr><th>Option</th><th class="right">Time to market</th><th class="right">Year-1 cost</th><th>Control</th></tr></thead>
<tbody><tr><td>Direct</td><td class="right">12 mo</td><td class="right">$4.0M</td><td>High</td></tr>
<tr><td>Partner-led</td><td class="right">5 mo</td><td class="right">$1.1M</td><td>Medium</td></tr>
<tr><td>Acquisition</td><td class="right">9 mo</td><td class="right">$18M</td><td>High</td></tr></tbody></table>
<div class="exhibit">Exhibit 1 — Entry model comparison (finance, Q3 2026).</div>
<p class="pull">"Speed to revenue, not control, is the binding constraint this cycle."</p>
<h2>2 · Recommendation</h2>
<div class="bottomline">Bottom line: enter via a regional partner in H1, retaining an option to acquire in year 2 once demand is proven.</div>`,

  academic: `
<div class="titleblock"><h1>Grounded Generation Reduces Hallucination in Document Synthesis</h1>
<div class="authors">A. Chatterjee, R. Mensah, L. Ortiz</div><div class="affil">Chorale Research · Independent</div></div>
<div class="abstract"><h3>Abstract</h3><p>We show that a post-generation fidelity check reduces fabricated figures in model-authored reports by 92% without measurable loss of fluency. Across 240 documents, grounded generation preserved all source statistics while flagging invented values for correction.</p></div>
<div class="twocol"><h2><span class="n">1.</span> Introduction</h2><p>Large language models restructure source content fluently but frequently introduce numbers absent from the source<sup class="cite">1</sup>. Prior work styles output without verifying it.</p>
<div class="figure">[ Figure ]<div class="caption">Figure 1: Fabrication rate before and after the fidelity check.</div></div>
<h2><span class="n">2.</span> Method</h2><p>We extract distinctive numerals from the artifact's visible text and require each to appear in the source corpus. Violations are returned for a bounded repair loop.</p>
<h2><span class="n">3.</span> Results</h2><p>The check caught fabrications in 41 of 240 runs; all were corrected within two rounds.</p></div>
<h2>References</h2><ol class="refs"><li>Chatterjee, A. <em>Anti-hallucination in document agents.</em> 2026.</li><li>Ortiz, L. <em>Fidelity metrics for generated media.</em> 2025.</li></ol>`,

  legal: `
<div class="confidential">Confidential</div><h1>Mutual Non-Disclosure Agreement</h1>
<p class="parties">This Agreement is entered into by and between <strong>Chorale Labs</strong> ("Disclosing Party") and <strong>the Counterparty</strong> ("Receiving Party") as of the Effective Date.</p>
<p class="recital">WHEREAS the parties wish to explore a potential business relationship and may disclose confidential information for that purpose;</p>
<ol class="clauses"><li><span class="defterm">Definitions.</span> <dl class="defs"><dt>Confidential Information</dt><dd>means any non-public information disclosed by a party, in any form.</dd></dl></li>
<li>Obligations.<ol><li>The Receiving Party shall use Confidential Information solely to evaluate the relationship.</li><li>The Receiving Party shall not disclose it to third parties without prior written consent.</li></ol></li>
<li>Term. This Agreement remains in effect for two (2) years from the Effective Date.</li>
<li>Governing Law. This Agreement is governed by the laws of the applicable jurisdiction.</li></ol>
<div class="sig"><div class="block"><div class="line">Disclosing Party — signature &amp; date</div></div><div class="block"><div class="line">Receiving Party — signature &amp; date</div></div></div>`,

  invoice: `
<div class="inv-head"><div><div class="co">Chorale Labs</div><div class="muted">hello@chorale.dev · Remote</div></div>
<div class="lbl"><h1>INVOICE</h1><div class="muted">#INV-2026-014</div><div class="due">Due 30 Jul 2026</div></div></div>
<div class="meta-grid"><div class="b"><div class="h">Bill To</div>Acme Corp<br>123 Market St<br>Berlin</div><div class="b"><div class="h">Issued</div>16 Jul 2026</div></div>
<table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
<tbody><tr><td>Design system implementation</td><td class="num">40</td><td class="num">$120.00</td><td class="num">$4,800.00</td></tr>
<tr><td>Report automation</td><td class="num">12</td><td class="num">$120.00</td><td class="num">$1,440.00</td></tr></tbody></table>
<div class="totals"><div class="row"><span>Subtotal</span><span>$6,240.00</span></div><div class="row"><span>Tax (19%)</span><span>$1,185.60</span></div>
<div class="row grand"><span>Total</span><span>$7,425.60</span></div></div>
<div class="terms">Payment due within 30 days by bank transfer. Thank you for your business.</div>`,

  resume: `
<div class="cvhead"><h1>Jordan Rivera</h1><div class="role">Senior Software Engineer</div>
<div class="contact"><span>jordan@example.com</span><span>Berlin</span><span>github.com/jrivera</span></div></div>
<div class="cvgrid"><div class="side"><h3>Skills</h3><span class="tag">TypeScript</span><span class="tag">Node</span><span class="tag">React</span><span class="tag">Postgres</span>
<h3 style="margin-top:1rem">Languages</h3>English<div class="bar"><i style="width:100%"></i></div>German<div class="bar"><i style="width:70%"></i></div>
<h3 style="margin-top:1rem">Education</h3><div class="xp"><div class="top"><span>BSc Computer Science</span></div><div class="org">TU Berlin</div></div></div>
<div class="main"><h3>Experience</h3>
<div class="xp"><div class="top"><span>Staff Engineer</span><span class="date">2023 — now</span></div><div class="org">Chorale Labs</div><p class="muted">Led the document-agent platform; shipped grounded generation and multi-format export.</p></div>
<div class="xp"><div class="top"><span>Senior Engineer</span><span class="date">2020 — 2023</span></div><div class="org">Acme Corp</div><p class="muted">Built the analytics pipeline serving 2M daily events.</p></div></div></div>`,

  clinical: `
<div class="pt-head"><div class="f"><div class="h">Patient</div>J. Doe · 41 · M</div><div class="f"><div class="h">Specimen</div>Serum</div><div class="f"><div class="h">Collected</div>16 Jul 2026 08:20</div><div class="f"><div class="h">Accession</div>LAB-88213</div></div>
<h2>Complete Metabolic Panel</h2>
<table><thead><tr><th>Analyte</th><th class="num">Result</th><th>Units</th><th>Reference range</th><th>Flag</th></tr></thead>
<tbody><tr><td>Glucose</td><td class="num">92</td><td>mg/dL</td><td>70–99</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr class="abn"><td>ALT</td><td class="num">68</td><td>U/L</td><td>7–56</td><td><span class="flag flag-h">High</span></td></tr>
<tr class="abn"><td>Potassium</td><td class="num">3.2</td><td>mmol/L</td><td>3.5–5.1</td><td><span class="flag flag-l">Low</span></td></tr></tbody></table>
<div class="interp"><strong>Interpretation.</strong> Mildly elevated ALT and low potassium; correlate clinically and consider repeat testing.</div>
<div class="disclaimer">This report is for the ordering clinician. Reference ranges are method-specific. Not a diagnosis.</div>`,

  marketing: `
<div class="hero"><h1>Ship docs that never lie.</h1><p>Scribe turns your data into polished, on-brand reports — grounded, fidelity-checked, print-ready.</p><a class="cta">Start free</a></div>
<div class="features"><div class="feature"><div class="ico">🎨</div><h3>10 design profiles</h3><p class="muted">Report, invoice, clinical, legal, and more — each honest to its industry.</p></div>
<div class="feature"><div class="ico">🔒</div><h3>No fabricated data</h3><p class="muted">Every number is verified against your source. Automatically.</p></div>
<div class="feature"><div class="ico">📄</div><h3>Any format</h3><p class="muted">PDF, DOCX, XLSX, PPTX, HTML — one command.</p></div></div>
<div class="statsband"><div class="s"><div class="big">10</div><div class="l">profiles</div></div><div class="s"><div class="big">0</div><div class="l">fabricated figures</div></div><div class="s"><div class="big">7</div><div class="l">formats</div></div></div>
<h2 class="center">Pricing</h2><div class="pricing"><div class="tier"><h3>Free</h3><div class="price">$0</div><p class="muted">Core themes</p></div>
<div class="tier popular"><h3>Pro</h3><div class="price">$12</div><p class="muted">All profiles + charts</p></div>
<div class="tier"><h3>Team</h3><div class="price">$40</div><p class="muted">Shared house styles</p></div></div>`,

  editorial: `
<div class="masthead"><span>The Chorale Review</span><span>Issue 07 · July 2026</span></div>
<h1>The quiet revolution in machine-written documents</h1>
<div class="byline">By A. Chatterjee · 6 min read</div>
<p class="lead">For years, the promise of machine-authored reports came with a catch: they looked convincing and were sometimes wrong. That trade-off is finally breaking, and the fix is less glamorous than the models themselves.</p>
<p>The shift is not a bigger model. It is a small, stubborn checker that reads what the model produced and refuses to let a number through unless it appears in the source.</p>
<p class="pull">"Polish was never the hard part. Honesty was."</p>
<p>The result reads like a designer made it and an auditor signed it — a combination that, until recently, did not exist in the same document.</p>
<div class="foot">The Chorale Review · Independent · Reproduction with attribution.</div>`,

  recipe: `
<h1>One-Pan Lemon Herb Chicken</h1>
<div class="r-meta"><span class="badge"><b>15 min</b>Prep</span><span class="badge"><b>35 min</b>Cook</span><span class="badge"><b>4</b>Servings</span><span class="badge"><b>Easy</b>Level</span></div>
<div class="cook"><div class="ingredients"><h3>Ingredients</h3><ul><li>4 chicken thighs</li><li>2 lemons</li><li>3 cloves garlic</li><li>2 tbsp olive oil</li><li>Fresh thyme &amp; rosemary</li><li>Salt &amp; pepper</li></ul></div>
<div><h3>Method</h3><ol class="steps"><li>Heat the oven to 200°C. Pat the chicken dry and season well.</li>
<li>Sear the thighs skin-side down in olive oil for 5 minutes until golden.</li>
<li>Add sliced lemon, garlic, and herbs to the pan; roast for 30 minutes.</li>
<li>Rest for 5 minutes, spoon over the pan juices, and serve.</li></ol>
<div class="tip">Tip: Save the rendered lemon-herb fat — it makes an excellent dressing.</div></div></div>`,

  techdoc: `
<h1>Documents API</h1>
<div class="toc"><h3>On this page</h3><a href="#read">Reading documents</a><a href="#write">Writing documents</a><a href="#convert">Converting</a></div>
<h2 id="read">Reading documents</h2><p>Use <code>read_doc</code> to extract text from any supported format.</p>
<div class="adm info"><div class="t">Info</div>Spreadsheets are returned as Markdown tables.</div>
<pre><code>const { content } = await read_doc({ path: "report.pdf" });</code></pre>
<h2 id="write">Writing documents</h2><p><span class="method m-post">POST</span> <code>write_doc(path, content, theme?)</code></p>
<table><thead><tr><th>Param</th><th>Type</th><th>Notes</th></tr></thead>
<tbody><tr><td><code>path</code></td><td><code>string</code></td><td>Output path; format from the extension</td></tr>
<tr><td><code>theme</code></td><td><code>string</code></td><td>Design profile <span class="tag-dep">optional</span></td></tr></tbody></table>
<div class="adm warn"><div class="t">Warning</div>Binary output can't be edited afterward — regenerate from source.</div>
<h2 id="convert">Converting</h2><div class="adm tip"><div class="t">Tip</div>Press <kbd>Ctrl</kbd> + <kbd>P</kbd> to print any generated HTML to PDF.</div>
<pre><code>await convert({ from: "notes.md", to: "notes.pdf", theme: "report" });</code></pre>`,
};

const outDir = resolve(process.cwd(), "docs");
for (const [name, body] of Object.entries(DEMOS)) {
  const html = buildHtmlDoc(body, name as ThemeName);
  const file = resolve(outDir, `scribe-profile-${name}.html`);
  writeFileSync(file, html, "utf8");
  const s = scoreDesign(html);
  process.stdout.write(`  scribe-profile-${name.padEnd(10)} ${String(html.length).padStart(6)}b  ${s.lightSafe ? "light✓" : "DARK✗"}\n`);
}
process.stdout.write(`\nWrote ${Object.keys(DEMOS).length} profile demos to docs/scribe-profile-*.html\n`);
process.exit(0);

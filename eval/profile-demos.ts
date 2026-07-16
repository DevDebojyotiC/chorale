/**
 * Full-length (≈4–5 A4 pages) showcase content for each topic profile — realistic dummy
 * data that exercises the profile's full component vocabulary. Rendered by gen-profiles.ts.
 * All content is fictional. Kept light + print-friendly by the themes.
 */

const executive = `
<div class="cover"><div class="kicker">Strategy Brief · Confidential · Q3 2026</div><h1>European Market Expansion Assessment</h1>
<p style="opacity:.92;margin:.5rem 0 0;max-width:46rem">A board-level evaluation of three entry models for Northwind's SaaS platform in the EU, with a recommended phased approach and a two-year financial outlook.</p></div>

<div class="exsum"><h3>Executive Summary</h3><ul>
<li>The addressable EU opportunity is <strong>$1.24B</strong> and growing <strong>14% YoY</strong>; Northwind currently captures none of it.</li>
<li>Three entry models were assessed on time-to-revenue, first-year cost, and control. No single model dominates on all three.</li>
<li><strong>Direct entry</strong> maximizes long-run margin but carries the highest execution risk and a 12-month runway to first revenue.</li>
<li><strong>Partner-led entry</strong> reaches revenue in 5 months at one-quarter the cost, trading some control and margin.</li>
<li><strong>Recommendation:</strong> a phased partner-led launch in H1 2026, converting to a direct model in year two once demand and unit economics are proven. Expected two-year contribution: <strong>$6.8M</strong>.</li></ul></div>

<h2>1 · Context &amp; Objectives</h2>
<p>Northwind's growth in North America has decelerated from 60% to 28% annually as the segment matures. The board has asked management to evaluate international expansion as the primary lever for returning to a "Rule of 40" trajectory. Europe is the natural first market: high digital maturity, favourable regulatory alignment after recent data-portability reforms, and an existing inbound signal — 9% of trial sign-ups already originate from EU IP addresses despite no localized offering.</p>
<p>This brief evaluates <em>how</em> to enter, not <em>whether</em>. Three objectives frame the analysis: (1) reach meaningful revenue within 12 months, (2) keep first-year cash exposure below $5M, and (3) preserve the option to own the customer relationship over time.</p>
<p class="pull">"The binding constraint this cycle is speed to revenue, not control. We can buy back control; we cannot buy back a lost year."</p>

<h2>2 · Market Sizing</h2>
<p>We triangulated the opportunity bottom-up (target accounts × ACV) and top-down (analyst TAM × serviceable share). The two methods converge within 8%, giving reasonable confidence in the $1.24B figure.</p>
<table><thead><tr><th>Region</th><th class="right">Target accounts</th><th class="right">Avg ACV</th><th class="right">Serviceable market</th></tr></thead>
<tbody><tr><td>DACH</td><td class="right">4,200</td><td class="right">$41,000</td><td class="right">$172M</td></tr>
<tr><td>UK &amp; Ireland</td><td class="right">3,800</td><td class="right">$38,500</td><td class="right">$146M</td></tr>
<tr><td>Nordics</td><td class="right">2,100</td><td class="right">$44,000</td><td class="right">$92M</td></tr>
<tr><td>Benelux + France</td><td class="right">6,300</td><td class="right">$36,000</td><td class="right">$227M</td></tr>
<tr><td><strong>Total (near-term)</strong></td><td class="right"><strong>16,400</strong></td><td class="right">—</td><td class="right"><strong>$637M</strong></td></tr></tbody></table>
<div class="exhibit">Exhibit 1 — Serviceable market by region, near-term horizon. Full TAM including adjacent segments is $1.24B.</div>
<p>DACH and the Benelux/France cluster together represent 63% of the near-term opportunity and share the most overlap with Northwind's existing ICP (mid-market operations teams). We therefore weight the go-to-market plan toward these two clusters in year one.</p>

<h2>3 · Options Analysis</h2>
<p>Each model was scored against the three objectives. The table below summarizes the trade-offs; narrative follows.</p>
<table><thead><tr><th>Option</th><th class="right">Time to market</th><th class="right">Year-1 cost</th><th>Control</th><th class="right">Yr-2 margin</th><th>Execution risk</th></tr></thead>
<tbody><tr><td>Direct (own entity)</td><td class="right">12 mo</td><td class="right">$4.0M</td><td>High</td><td class="right">72%</td><td>High</td></tr>
<tr><td>Partner-led</td><td class="right">5 mo</td><td class="right">$1.1M</td><td>Medium</td><td class="right">54%</td><td>Low</td></tr>
<tr><td>Acquisition</td><td class="right">9 mo</td><td class="right">$18.0M</td><td>High</td><td class="right">61%</td><td>Medium</td></tr></tbody></table>
<div class="exhibit">Exhibit 2 — Entry model comparison across the three board objectives.</div>
<p><strong>Direct entry</strong> means standing up a legal entity, hiring a local team, and localizing product and billing. It preserves full margin and the customer relationship but front-loads cost and delays revenue by roughly a year — failing objective 1.</p>
<p><strong>Partner-led entry</strong> uses two established regional resellers with existing mid-market relationships. Revenue arrives quickly and cheaply, at the cost of a revenue share (32%) and reduced pricing control. Critically, it de-risks the market thesis before large capital is committed.</p>
<p><strong>Acquisition</strong> of a smaller local competitor would buy instant presence and a team, but at 18× forward revenue it fails objective 2 and introduces material integration risk.</p>

<h2>4 · Financial Outlook</h2>
<p>The recommended phased plan assumes partner-led launch in H1, a direct-model transition beginning month 14, and blended economics thereafter. Figures are contribution (revenue less directly attributable cost), not fully-loaded.</p>
<table><thead><tr><th>Metric</th><th class="right">Year 1</th><th class="right">Year 2</th><th class="right">Two-year</th></tr></thead>
<tbody><tr><td>New ARR</td><td class="right">$2.1M</td><td class="right">$7.4M</td><td class="right">$9.5M</td></tr>
<tr><td>Revenue (recognized)</td><td class="right">$1.3M</td><td class="right">$5.6M</td><td class="right">$6.9M</td></tr>
<tr><td>Directly attributable cost</td><td class="right">$1.1M</td><td class="right">$3.9M</td><td class="right">$5.0M</td></tr>
<tr><td><strong>Contribution</strong></td><td class="right"><strong>$0.2M</strong></td><td class="right"><strong>$1.7M</strong></td><td class="right"><strong>$1.9M</strong></td></tr></tbody></table>
<p>Contribution turns clearly positive in year two as the direct model lifts gross margin from 54% to a blended 66%. Sensitivity analysis (not shown) indicates the plan remains cash-safe under a 30% revenue miss.</p>

<h2>5 · Risks &amp; Mitigations</h2>
<p>Three risks warrant board attention. <strong>Partner mis-alignment</strong> — a reseller may deprioritize Northwind; mitigated by a minimum-commitment clause and a 90-day performance gate. <strong>Regulatory drift</strong> — data-residency rules could tighten; mitigated by an EU-hosted deployment from day one. <strong>Transition friction</strong> — moving customers from partner to direct billing in year two risks churn; mitigated by a co-managed handover and grandfathered pricing.</p>

<h2>6 · Recommendation</h2>
<div class="bottomline">Enter Europe via a partner-led launch in H1 2026, focused on the DACH and Benelux/France clusters, and retain a contractual option to transition to a direct model in year two once the market thesis and unit economics are proven. Two-year contribution of $1.9M with limited downside; the strategic value is the option, not the year-one P&amp;L.</div>
<p class="muted" style="font-size:.82rem;margin-top:1.4rem">¹ ACV = annual contract value. ² Contribution excludes shared corporate overhead. ³ All figures illustrative and prepared for internal discussion only.</p>`;

const academic = `
<div class="titleblock"><h1>Grounded Generation Reduces Fabrication in Model-Authored Documents</h1>
<div class="authors">A. Chatterjee¹, R. Mensah², L. Ortiz¹</div><div class="affil">¹ Chorale Research · ² Independent</div></div>
<div class="abstract"><h3>Abstract</h3><p>Large language models restructure source material fluently but frequently introduce numerical values absent from the source — a failure mode that undermines their use in reports, finance, and clinical settings. We introduce a lightweight, post-generation <em>fidelity check</em> that extracts distinctive numerals from a generated document's visible text and requires each to be grounded in the source corpus, returning violations for a bounded repair loop. Across 240 model-authored documents drawn from six domains, the check reduced fabricated figures by 92% while preserving all source statistics and showing no measurable degradation in a blind fluency evaluation (Δ = 0.03, n.s.). We analyze the residual failures, characterize the trade-off between recall and false positives, and release the evaluation harness.</p></div>

<div class="twocol">
<h2><span class="n">1.</span> Introduction</h2>
<p>Automated document synthesis has advanced rapidly, yet adoption in high-stakes domains lags. The obstacle is not fluency but trust: a report that reads convincingly and is occasionally wrong is worse than one that is plainly rough<sup class="cite">1</sup>. Prior systems style or convert source content without verifying the output against a ground truth, so hallucinated statistics pass through unchecked<sup class="cite">2,3</sup>.</p>
<p>We argue that the correct locus of verification is not the model but a cheap, deterministic checker applied after generation. The insight is that <em>numbers</em> are both the most consequential and the most checkable claims in a data-bearing document. If every distinctive numeral in the artifact must appear in the source, fabrication becomes detectable without any model introspection.</p>
<h2><span class="n">2.</span> Related Work</h2>
<p>Retrieval-augmented generation<sup class="cite">4</sup> grounds inputs but not outputs. Self-consistency<sup class="cite">5</sup> and self-critique<sup class="cite">6</sup> improve reasoning yet do not guarantee data fidelity. Closest is claim-verification work<sup class="cite">7</sup>, which we specialize to numerals for precision and speed.</p>
<div class="figure">[ Figure 1 ]<div class="caption">Figure 1: Fabrication rate per domain, before (dark) and after (light) the fidelity check.</div></div>
<h2><span class="n">3.</span> Method</h2>
<p>Given a generated artifact and its source(s), we strip markup to visible text, extract numerals with two or more significant digits or a decimal point (skipping trivial list markers), and test membership against numerals extracted from the source. Un-grounded numerals are surfaced with a targeted instruction; the model revises within a bounded loop of at most five rounds. Dropped source numerals are permitted, reflecting the summarizing nature of reports.</p>
<h2><span class="n">4.</span> Experiments</h2>
<p>We sampled 240 tasks across executive reports, invoices, lab summaries, and three other domains, each with a fixed source. Two models authored each task. We measured fabrication rate, source-recall, repair rounds, and a blind fluency score (5-point Likert, three raters).</p>
<table><thead><tr><th>Domain</th><th class="right">Baseline fab.</th><th class="right">+ Check</th><th class="right">Rounds</th></tr></thead>
<tbody><tr><td>Executive</td><td class="right">18%</td><td class="right">2%</td><td class="right">1.4</td></tr>
<tr><td>Finance</td><td class="right">24%</td><td class="right">1%</td><td class="right">1.7</td></tr>
<tr><td>Clinical</td><td class="right">11%</td><td class="right">0%</td><td class="right">1.2</td></tr>
<tr><td>Marketing</td><td class="right">31%</td><td class="right">3%</td><td class="right">1.9</td></tr></tbody></table>
<div class="caption">Table 1: Fabrication rate and mean repair rounds by domain.</div>
<h2><span class="n">5.</span> Results &amp; Discussion</h2>
<p>The check caught fabrications in 41 of 240 runs; all resolved within two rounds. Marketing showed both the highest baseline fabrication and the highest residual, consistent with a genre that rewards inflation. Fluency was statistically unchanged, indicating that grounding constrains data without flattening prose.</p>
<p>Residual failures fell into two classes: unit reformatting (e.g., "4M" vs "4,000,000") and legitimately derived figures (a computed percentage). The former is addressable with normalization; the latter suggests a future extension to arithmetic provenance.</p>
<h2><span class="n">6.</span> Ablations</h2>
<p>We ablate three design choices. Removing the two-significant-digit filter raises false positives 4× as trivial list markers and years are flagged. Disabling the repair loop leaves 39 of 41 fabrications uncorrected, confirming that detection alone is insufficient. Extending membership from exact match to normalized match (stripping currency and thousands separators) recovers 6 of the 9 residual "unit reformatting" failures at no precision cost.</p>
<table><thead><tr><th>Configuration</th><th class="right">Fab. caught</th><th class="right">False pos.</th></tr></thead>
<tbody><tr><td>Full method</td><td class="right">41/41</td><td class="right">2%</td></tr>
<tr><td>− digit filter</td><td class="right">41/41</td><td class="right">9%</td></tr>
<tr><td>− repair loop</td><td class="right">2/41</td><td class="right">2%</td></tr>
<tr><td>+ normalization</td><td class="right">41/41</td><td class="right">2%</td></tr></tbody></table>
<div class="caption">Table 2: Ablation of the three design choices.</div>
<h2><span class="n">7.</span> Limitations</h2>
<p>The method verifies presence, not derivation: a figure computed correctly from source values but absent verbatim is flagged as a false positive. Extending to arithmetic provenance is future work. The approach also assumes a well-defined source; open-ended generative tasks without a ground truth are out of scope. Finally, our fluency evaluation used three raters on a five-point scale; a larger panel would tighten the confidence interval.</p>
<h2><span class="n">8.</span> Conclusion</h2>
<p>A deterministic numeral-fidelity check materially reduces fabrication in model-authored documents at negligible cost and no fluency penalty. Grounding output — not merely input — is a practical path to trustworthy document synthesis. We release the harness and the 240-document benchmark to support replication.</p>
</div>
<h2>Broader Impact &amp; Reproducibility</h2>
<p>The technique lowers the barrier to trustworthy automation in domains where a single fabricated figure carries real cost — finance, healthcare, and law. Because the checker is deterministic and model-agnostic, it composes with any generation stack and adds no dependency on a particular provider. We caution that the method verifies numerals only; textual claims, causal assertions, and images remain unverified and require separate scrutiny.</p>
<p>All experiments were run with fixed seeds where the model permitted, and the 240-document benchmark, grader, and extraction rules are released under a permissive licence. Reported figures are means over three runs; variance was below one percentage point on all domains except marketing, where run-to-run spread reached three points.</p>
<h2>Appendix A · Extraction rules</h2>
<p class="muted" style="font-size:.85rem">Numerals are matched with the pattern for signed integers and decimals of two or more significant digits. List ordinals, single-digit counts, and standalone years are excluded. Percentages and currency values retain their magnitude after separator normalization. Full rules and the reference implementation accompany the release.</p>
<h2>Appendix B · Domain corpus</h2>
<p class="muted" style="font-size:.85rem">The 240-document benchmark draws 40 documents each from six domains: executive briefs, financial statements, clinical summaries, marketing pages, technical references, and academic abstracts. Each document is paired with a structured source of record, against which fidelity is measured. Sources were synthetic to avoid disclosing real data.</p>
<h2>References</h2>
<ol class="refs">
<li>Chatterjee, A. and Ortiz, L. <em>Anti-hallucination in document agents.</em> Proc. of DocML, 2026.</li>
<li>Mensah, R. <em>When generated reports go wrong.</em> J. Applied NLP, 2025.</li>
<li>Ortiz, L. et al. <em>Fidelity metrics for generated media.</em> 2025.</li>
<li>Lewis, P. et al. <em>Retrieval-augmented generation.</em> 2020.</li>
<li>Wang, X. et al. <em>Self-consistency improves reasoning.</em> 2022.</li>
<li>Madaan, A. et al. <em>Self-refine.</em> 2023.</li>
<li>Thorne, J. et al. <em>Fact verification over evidence.</em> 2018.</li>
</ol>`;

const legal = `
<div class="confidential">Confidential</div>
<h1>Master Services Agreement</h1>
<p class="parties">This Master Services Agreement ("<span class="defterm">Agreement</span>") is entered into as of the Effective Date by and between <strong>Chorale Labs Ltd.</strong>, a company organized under the laws of the applicable jurisdiction ("<span class="defterm">Provider</span>"), and the counterparty identified in the applicable Order Form ("<span class="defterm">Client</span>"). Provider and Client are each a "Party" and together the "Parties."</p>
<p class="recital">WHEREAS Provider offers a document-automation platform and related professional services; and WHEREAS Client wishes to engage Provider to provide such services subject to the terms herein; NOW THEREFORE, in consideration of the mutual covenants below, the Parties agree as follows.</p>

<ol class="clauses">
<li><span class="defterm">Definitions.</span> Capitalized terms have the meanings set out below.
<dl class="defs">
<dt>Confidential Information</dt><dd>means any non-public information disclosed by a Party, in any form, that is designated confidential or would reasonably be understood to be confidential.</dd>
<dt>Deliverables</dt><dd>means the outputs to be produced by Provider as described in an Order Form or Statement of Work.</dd>
<dt>Order Form</dt><dd>means an ordering document executed by the Parties referencing this Agreement.</dd>
</dl></li>
<li>Services.<ol>
<li>Provider shall perform the services described in each Order Form with reasonable skill and care and in accordance with generally accepted industry standards.</li>
<li>Provider may engage subcontractors provided it remains responsible for their performance.</li>
<li>Client shall provide timely access to materials and personnel reasonably required for Provider to perform.</li></ol></li>
<li>Fees &amp; Payment.<ol>
<li>Client shall pay the fees set out in the applicable Order Form. Unless stated otherwise, invoices are due within thirty (30) days of the invoice date.</li>
<li>Late amounts accrue interest at 1.5% per month or the maximum rate permitted by law, whichever is lower.</li>
<li>Fees are exclusive of applicable taxes, which are the responsibility of the Client.</li></ol></li>
<li>Confidentiality.<ol>
<li>Each Party shall use the other's Confidential Information solely to perform this Agreement and shall not disclose it to third parties without prior written consent.</li>
<li>The obligations in this Section survive termination for a period of three (3) years.</li></ol></li>
<li>Intellectual Property.<ol>
<li>Each Party retains ownership of its pre-existing intellectual property.</li>
<li>Upon full payment, Provider assigns to Client all right, title, and interest in the Deliverables, excluding Provider's pre-existing tools and libraries, for which Client receives a perpetual, non-exclusive licence.</li></ol></li>
<li>Warranties &amp; Disclaimers.<ol>
<li>Each Party warrants that it has the authority to enter into this Agreement.</li>
<li>EXCEPT AS EXPRESSLY STATED, THE SERVICES ARE PROVIDED "AS IS" AND PROVIDER DISCLAIMS ALL IMPLIED WARRANTIES TO THE EXTENT PERMITTED BY LAW.</li></ol></li>
<li>Limitation of Liability.<ol>
<li>Neither Party is liable for indirect, incidental, or consequential damages.</li>
<li>Each Party's aggregate liability shall not exceed the fees paid in the twelve (12) months preceding the claim.</li></ol></li>
<li>Term &amp; Termination.<ol>
<li>This Agreement commences on the Effective Date and continues until terminated in accordance with this Section.</li>
<li>Either Party may terminate for material breach not cured within thirty (30) days of written notice.</li>
<li>Upon termination, Client shall pay for services rendered through the effective date of termination.</li></ol></li>
<li>Data Protection.<ol>
<li>Each Party shall comply with applicable data-protection laws in respect of any personal data processed under this Agreement.</li>
<li>Where Provider processes personal data on Client's behalf, it shall do so only on documented instructions and shall implement appropriate technical and organizational measures.</li>
<li>Each Party shall notify the other without undue delay upon becoming aware of a personal-data breach affecting the other's data.</li></ol></li>
<li>Insurance. Provider shall maintain, at its own expense, commercial general liability and professional indemnity insurance in amounts customary for its industry, and shall furnish a certificate on reasonable request.</li>
<li>Force Majeure. Neither Party is liable for any failure or delay caused by events beyond its reasonable control, including acts of God, war, labour disputes, or failures of the internet or telecommunications, provided it uses reasonable efforts to resume performance.</li>
<li>Assignment. Neither Party may assign this Agreement without the other's prior written consent, except to a successor in connection with a merger or sale of substantially all assets, on notice.</li>
<li>Notices. All notices shall be in writing and delivered to the addresses set out in the Order Form, by hand, recognized courier, or email with confirmation of receipt. Notices are deemed given on receipt.</li>
<li>Dispute Resolution. The Parties shall first attempt to resolve any dispute through good-faith negotiation between senior representatives. Failing resolution within thirty (30) days, the dispute shall be finally settled by binding arbitration under the applicable rules.</li>
<li>Governing Law. This Agreement is governed by the laws of the applicable jurisdiction, without regard to conflict-of-laws principles.</li>
<li>Miscellaneous. This Agreement constitutes the entire understanding of the Parties, supersedes prior agreements, and may be amended only in a writing signed by both Parties. No waiver of any breach is a waiver of any subsequent breach. If any provision is held unenforceable, the remainder shall continue in full force and effect.</li>
</ol>

<p style="margin-top:1.4rem">IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.</p>
<div class="sig"><div class="block"><div class="line">Chorale Labs Ltd. — Authorized signatory &amp; date</div></div><div class="block"><div class="line">Client — Authorized signatory &amp; date</div></div></div>

<h2 style="margin-top:2rem">Schedule A — Service Levels</h2>
<p>This Schedule forms part of the Agreement. In the event of conflict between this Schedule and the body of the Agreement, the body prevails except as to the specific matters addressed herein.</p>
<ol class="clauses">
<li>Availability. Provider shall use commercially reasonable efforts to maintain platform availability of 99.5% measured monthly, excluding scheduled maintenance notified at least forty-eight (48) hours in advance.</li>
<li>Support. Provider shall respond to critical issues within four (4) business hours and to non-critical issues within two (2) business days.</li>
<li>Service Credits. For each full percentage point below the availability target, Client is entitled to a credit of two percent (2%) of the monthly fee, capped at fifteen percent (15%). Service credits are the Client's sole remedy for availability failures.</li>
</ol>`;

const invoice = `
<div class="inv-head"><div><div class="co">Chorale Labs</div><div class="muted">hello@chorale.dev · VAT DE123456789<br>Prinzenstraße 84, 10969 Berlin</div></div>
<div class="lbl"><h1>INVOICE</h1><div class="muted">#INV-2026-0142</div><div class="due">Due 15 Aug 2026</div></div></div>

<div class="meta-grid"><div class="b"><div class="h">Bill To</div>Acme Corporation<br>Attn: Accounts Payable<br>123 Market Street<br>Munich, 80331</div>
<div class="b"><div class="h">Ship To</div>Same as billing</div>
<div class="b"><div class="h">Invoice date</div>16 Jul 2026</div>
<div class="b"><div class="h">Terms</div>Net 30</div></div>

<table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
<tbody>
<tr><td>Design system implementation — foundation</td><td class="num">40</td><td class="num">hr</td><td class="num">$120.00</td><td class="num">$4,800.00</td></tr>
<tr><td>Report automation pipeline</td><td class="num">12</td><td class="num">hr</td><td class="num">$120.00</td><td class="num">$1,440.00</td></tr>
<tr><td>Template library — 10 topic profiles</td><td class="num">1</td><td class="num">ea</td><td class="num">$2,500.00</td><td class="num">$2,500.00</td></tr>
<tr><td>PDF/DOCX export integration</td><td class="num">8</td><td class="num">hr</td><td class="num">$120.00</td><td class="num">$960.00</td></tr>
<tr><td>Accessibility &amp; print QA</td><td class="num">6</td><td class="num">hr</td><td class="num">$110.00</td><td class="num">$660.00</td></tr>
<tr><td>Onboarding &amp; handover session</td><td class="num">2</td><td class="num">ea</td><td class="num">$300.00</td><td class="num">$600.00</td></tr>
</tbody></table>

<div class="totals">
<div class="row"><span>Subtotal</span><span>$11,960.00</span></div>
<div class="row"><span>Discount (loyalty, 5%)</span><span>−$598.00</span></div>
<div class="row"><span>Tax (19% VAT)</span><span>$2,158.78</span></div>
<div class="row grand"><span>Total due</span><span>$13,520.78</span></div></div>

<div class="terms"><strong>Payment.</strong> Bank transfer to Chorale Labs — IBAN DE00 1234 5678 9012 3456 00 · BIC ABCDDEFFXXX. Please reference invoice #INV-2026-0142. A 1.5%/month late fee applies after the due date.</div>

<h2 style="margin-top:1.8rem">Account Statement</h2>
<p class="muted" style="font-size:.85rem">Recent activity on this account, for reference.</p>
<table><thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th class="num">Amount</th></tr></thead>
<tbody>
<tr><td>INV-2026-0118</td><td>15 May 2026</td><td>Paid</td><td class="num">$9,240.00</td></tr>
<tr><td>INV-2026-0130</td><td>16 Jun 2026</td><td>Paid</td><td class="num">$7,425.60</td></tr>
<tr><td>INV-2026-0142</td><td>16 Jul 2026</td><td>Due</td><td class="num">$13,520.78</td></tr></tbody></table>

<h2 style="margin-top:1.8rem">Work Summary</h2>
<p class="muted" style="font-size:.9rem">This engagement covered the design and delivery of a document-automation system: a shared theming foundation, ten industry design profiles, numeric-table charting, and export to PDF, DOCX, and XLSX. Foundation and template work were fixed-scope; integration, QA, and onboarding were billed at the standard hourly rate. All deliverables were accepted on 12 July 2026.</p>
<table><thead><tr><th>Workstream</th><th class="num">Hours</th><th class="num">Amount</th></tr></thead>
<tbody>
<tr><td>Design system &amp; profiles</td><td class="num">40</td><td class="num">$7,300.00</td></tr>
<tr><td>Export &amp; integration</td><td class="num">20</td><td class="num">$2,400.00</td></tr>
<tr><td>QA, accessibility &amp; onboarding</td><td class="num">8</td><td class="num">$1,260.00</td></tr>
<tr><td><strong>Total</strong></td><td class="num"><strong>68</strong></td><td class="num"><strong>$10,960.00</strong></td></tr></tbody></table>

<h2>Terms &amp; Conditions</h2>
<p style="font-size:.88rem"><strong>1. Payment.</strong> Payment is due within thirty (30) days of the invoice date. Amounts are stated in USD and are exclusive of any bank charges, which are the responsibility of the payer.</p>
<p style="font-size:.88rem"><strong>2. Late payment.</strong> Overdue amounts accrue interest at 1.5% per month. Provider reserves the right to suspend services on accounts more than fifteen (15) days overdue.</p>
<p style="font-size:.88rem"><strong>3. Disputes.</strong> Any dispute regarding an invoice must be raised in writing within ten (10) business days of receipt; undisputed amounts remain due.</p>
<p style="font-size:.88rem"><strong>4. Taxes.</strong> Where a valid VAT identification number is supplied, the reverse-charge mechanism may apply. Client is responsible for any withholding required by local law.</p>

<h2 style="margin-top:1.8rem">Detailed Activity Log</h2>
<p class="muted" style="font-size:.9rem">Hours billed against this engagement, for reference. Totals reconcile to the Work Summary above.</p>
<table><thead><tr><th>Date</th><th>Activity</th><th class="num">Hours</th></tr></thead>
<tbody>
<tr><td>01 Jul</td><td>Kickoff, discovery, and design tokens</td><td class="num">6</td></tr>
<tr><td>02–03 Jul</td><td>Base theme and typography system</td><td class="num">10</td></tr>
<tr><td>04–05 Jul</td><td>Report &amp; docs profiles</td><td class="num">9</td></tr>
<tr><td>06–07 Jul</td><td>Invoice, legal, and clinical profiles</td><td class="num">8</td></tr>
<tr><td>08 Jul</td><td>Chart injection for numeric tables</td><td class="num">7</td></tr>
<tr><td>09 Jul</td><td>PDF/DOCX export integration</td><td class="num">12</td></tr>
<tr><td>10 Jul</td><td>Accessibility and print QA</td><td class="num">6</td></tr>
<tr><td>11–12 Jul</td><td>Onboarding sessions and handover</td><td class="num">10</td></tr>
<tr><td><strong>Total</strong></td><td></td><td class="num"><strong>68</strong></td></tr></tbody></table>

<h2>Purchase Order &amp; Approvals</h2>
<div class="meta-grid"><div class="b"><div class="h">PO number</div>ACME-PO-3391</div><div class="b"><div class="h">Approved by</div>D. Fischer, VP Eng</div><div class="b"><div class="h">Cost center</div>ENG-PLATFORM</div><div class="b"><div class="h">Contract</div>MSA-2025-014</div></div>
<p style="font-size:.88rem;margin-top:.6rem">This invoice is issued under the Master Services Agreement referenced above and against the approved purchase order. Deliverables were accepted in writing on 12 July 2026. No change orders were raised during this engagement.</p>

<h2>Deliverables &amp; Acceptance</h2>
<table><thead><tr><th>Deliverable</th><th>Accepted</th><th>Status</th></tr></thead>
<tbody>
<tr><td>Shared theming foundation</td><td>12 Jul 2026</td><td>Accepted</td></tr>
<tr><td>Ten industry design profiles</td><td>12 Jul 2026</td><td>Accepted</td></tr>
<tr><td>Numeric-table charting</td><td>12 Jul 2026</td><td>Accepted</td></tr>
<tr><td>PDF / DOCX / XLSX export</td><td>12 Jul 2026</td><td>Accepted</td></tr>
<tr><td>Documentation &amp; handover</td><td>12 Jul 2026</td><td>Accepted</td></tr></tbody></table>
<p style="font-size:.88rem">All deliverables listed above were reviewed and accepted by the Client's authorized representative. This acceptance triggers the payment terms set out in the Master Services Agreement.</p>

<h2>Billing Enquiries</h2>
<div class="meta-grid"><div class="b"><div class="h">Contact</div>billing@chorale.dev</div><div class="b"><div class="h">Phone</div>+49 30 9876 5432</div><div class="b"><div class="h">Hours</div>Mon–Fri, 09:00–17:00 CET</div></div>
<p style="font-size:.88rem;margin-top:.4rem">Please quote invoice #INV-2026-0142 and PO ACME-PO-3391 in any correspondence. Statements are issued monthly on the first business day.</p>

<div class="terms" style="margin-top:1.4rem"><strong>Remittance advice.</strong> Please detach and include with payment. Invoice #INV-2026-0142 · Amount due $13,520.78 · Due 15 Aug 2026 · Ref: ACME-0142.</div>`;

const resume = `
<div class="cvhead"><h1>Jordan Rivera</h1><div class="role">Senior Software Engineer · Platform &amp; Developer Tools</div>
<div class="contact"><span>jordan.rivera@example.com</span><span>+49 30 1234 5678</span><span>Berlin, DE</span><span>github.com/jrivera</span><span>jrivera.dev</span></div></div>

<div class="cvgrid">
<div class="side">
<h3>Skills</h3>
<span class="tag">TypeScript</span><span class="tag">Node.js</span><span class="tag">React</span><span class="tag">PostgreSQL</span><span class="tag">Rust</span><span class="tag">Docker</span><span class="tag">AWS</span><span class="tag">CI/CD</span><span class="tag">GraphQL</span><span class="tag">Testing</span>
<h3 style="margin-top:1.1rem">Languages</h3>
English (native)<div class="bar"><i style="width:100%"></i></div>
German (fluent)<div class="bar"><i style="width:82%"></i></div>
Spanish (conversational)<div class="bar"><i style="width:55%"></i></div>
<h3 style="margin-top:1.1rem">Education</h3>
<div class="xp"><div class="top"><span>MSc Computer Science</span></div><div class="org">TU Berlin · 2016–2018</div></div>
<div class="xp"><div class="top"><span>BSc Software Engineering</span></div><div class="org">Univ. of Manchester · 2013–2016</div></div>
<h3 style="margin-top:1.1rem">Certifications</h3>
<div class="muted" style="font-size:.86rem">AWS Solutions Architect · CKA (Kubernetes) · Advanced React (Frontend Masters)</div>
</div>

<div class="main">
<h3>Summary</h3>
<p>Senior engineer with 8 years building developer platforms and document tooling. I turn ambiguous product goals into reliable, well-tested systems, and I care about the details that make software feel trustworthy. Recently led a grounded document-generation platform from prototype to production.</p>
<p>I gravitate to the parts of a product where correctness and craft meet: data pipelines, developer tooling, and the rendering layer where a document either earns trust or loses it. I write things down, I test the boundaries, and I leave systems easier to change than I found them.</p>
<h3 style="margin-top:1rem">Impact at a Glance</h3>
<table><thead><tr><th>Outcome</th><th>Result</th></tr></thead>
<tbody>
<tr><td>Generated-report errors</td><td>−92%</td></tr>
<tr><td>Production incidents</td><td>−60%</td></tr>
<tr><td>Events handled (daily)</td><td>2M @ p99 &lt; 40ms</td></tr>
<tr><td>Open-source stars</td><td>1,400+</td></tr></tbody></table>
<h3 style="margin-top:1rem">Technical Skills Matrix</h3>
<table><thead><tr><th>Area</th><th>Tools</th><th>Level</th></tr></thead>
<tbody>
<tr><td>Languages</td><td>TypeScript, Rust, Python</td><td>Expert</td></tr>
<tr><td>Backend</td><td>Node, PostgreSQL, GraphQL</td><td>Expert</td></tr>
<tr><td>Frontend</td><td>React, CSS architecture, a11y</td><td>Advanced</td></tr>
<tr><td>Infra</td><td>Docker, Kubernetes, AWS, CI/CD</td><td>Advanced</td></tr>
<tr><td>Quality</td><td>Contract &amp; property testing</td><td>Expert</td></tr></tbody></table>
<h3 style="margin-top:1rem">Experience</h3>
<div class="xp"><div class="top"><span>Staff Software Engineer</span><span class="date">2023 — Present</span></div><div class="org">Chorale Labs · Berlin</div>
<p class="muted">Led the document-agent platform: grounded generation, an anti-hallucination fidelity check, and multi-format export (PDF/DOCX/XLSX). Cut fabricated figures in generated reports by 92%. Mentored four engineers; owned the design-system and theming work.</p></div>
<div class="xp"><div class="top"><span>Senior Software Engineer</span><span class="date">2020 — 2023</span></div><div class="org">Acme Corp · Remote</div>
<p class="muted">Built the analytics ingestion pipeline serving 2M daily events at p99 &lt; 40ms. Introduced contract testing that reduced production incidents by 60%. Led the migration from a monolith to typed services.</p></div>
<div class="xp"><div class="top"><span>Software Engineer</span><span class="date">2018 — 2020</span></div><div class="org">Northwind · Manchester</div>
<p class="muted">Shipped the customer-facing reporting module used by 12,000 accounts. Owned accessibility and print output; achieved WCAG AA compliance.</p></div>
<div class="xp"><div class="top"><span>Software Engineer (Graduate)</span><span class="date">2016 — 2018</span></div><div class="org">Meridian Systems · Manchester</div>
<p class="muted">Built internal tooling and dashboards; automated a manual reporting process that saved the operations team roughly a day each week.</p></div>
<h3 style="margin-top:1rem">Selected Projects</h3>
<div class="xp"><div class="top"><span>doc-themes</span></div><p class="muted">Open-source, print-friendly theming system with 10 topic profiles; 1.4k stars.</p></div>
<div class="xp"><div class="top"><span>groundcheck</span></div><p class="muted">A deterministic fidelity checker for model-authored documents; used in production.</p></div>
<h3 style="margin-top:1rem">Publications &amp; Talks</h3>
<div class="xp"><div class="top"><span>Grounded Generation Reduces Fabrication</span><span class="date">2026</span></div><div class="org">Proc. of DocML (co-author)</div></div>
<div class="xp"><div class="top"><span>"Print-first documents in a dark-mode world"</span><span class="date">2025</span></div><div class="org">FrontendConf EU · invited talk</div></div>
<div class="xp"><div class="top"><span>"Testing the untestable: contract tests at scale"</span><span class="date">2024</span></div><div class="org">NodeSummit · lightning talk</div></div>
<h3 style="margin-top:1rem">Awards &amp; Recognition</h3>
<ul><li>Engineering Excellence Award, Chorale Labs (2024)</li><li>Top 5% open-source contributor, DevGraph (2023)</li><li>Hackathon winner, Acme internal (2021)</li></ul>
<h3 style="margin-top:1rem">Selected Achievements</h3>
<ul><li>Reduced generated-report errors by 92% via an automated fidelity check now used in production.</li><li>Cut production incidents 60% by introducing contract testing across service boundaries.</li><li>Achieved WCAG AA compliance on a reporting module used by 12,000 accounts.</li><li>Grew an open-source theming library to 1,400 stars and 30+ contributors.</li></ul>
<h3 style="margin-top:1rem">Portfolio Highlights</h3>
<div class="xp"><div class="top"><span>Grounded document platform</span><span class="date">Chorale</span></div><p class="muted">Architected the end-to-end pipeline: markdown authoring, ten design profiles, fidelity checking, and multi-format export. Owned the theming system and the print-first output standard now used across the product.</p></div>
<div class="xp"><div class="top"><span>Analytics ingestion</span><span class="date">Acme</span></div><p class="muted">Designed a typed, back-pressured pipeline handling 2M daily events with sub-40ms p99; introduced contract tests that became the team's default practice.</p></div>
<div class="xp"><div class="top"><span>Accessible reporting module</span><span class="date">Northwind</span></div><p class="muted">Led the WCAG AA effort and the print-output redesign for a module used by 12,000 accounts.</p></div>
<h3 style="margin-top:1rem">References</h3>
<p class="muted">Available on request. Recent managers and collaborators at Chorale Labs and Acme Corp are happy to speak to my work.</p>
<h3 style="margin-top:1rem">Community &amp; Interests</h3>
<p class="muted">Maintainer of two open-source developer tools; mentor with a coding non-profit teaching teenagers to build their first web app. Outside work: long-distance cycling, film photography, and an ongoing quest for the perfect sourdough.</p>
</div></div>`;

const clinical = `
<div class="pt-head"><div class="f"><div class="h">Patient</div>J. Doe · 41 y · Male</div><div class="f"><div class="h">MRN</div>004-88213</div><div class="f"><div class="h">Ordering provider</div>Dr. A. Klein</div><div class="f"><div class="h">Specimen</div>Serum / Whole blood</div><div class="f"><div class="h">Collected</div>16 Jul 2026 08:20</div><div class="f"><div class="h">Reported</div>16 Jul 2026 14:05</div></div>

<h2>Complete Blood Count (CBC)</h2>
<table><thead><tr><th>Analyte</th><th class="num">Result</th><th>Units</th><th>Reference range</th><th>Flag</th></tr></thead>
<tbody>
<tr><td>Hemoglobin</td><td class="num">14.6</td><td>g/dL</td><td>13.5–17.5</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr><td>Hematocrit</td><td class="num">43.1</td><td>%</td><td>41–53</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr class="abn"><td>WBC</td><td class="num">11.8</td><td>10⁹/L</td><td>4.0–11.0</td><td><span class="flag flag-h">High</span></td></tr>
<tr><td>Platelets</td><td class="num">254</td><td>10⁹/L</td><td>150–400</td><td><span class="flag flag-n">Normal</span></td></tr></tbody></table>

<h2>Comprehensive Metabolic Panel (CMP)</h2>
<table><thead><tr><th>Analyte</th><th class="num">Result</th><th>Units</th><th>Reference range</th><th>Flag</th></tr></thead>
<tbody>
<tr><td>Glucose (fasting)</td><td class="num">92</td><td>mg/dL</td><td>70–99</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr><td>Sodium</td><td class="num">139</td><td>mmol/L</td><td>136–145</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr class="abn"><td>Potassium</td><td class="num">3.2</td><td>mmol/L</td><td>3.5–5.1</td><td><span class="flag flag-l">Low</span></td></tr>
<tr><td>Creatinine</td><td class="num">0.98</td><td>mg/dL</td><td>0.7–1.3</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr class="abn"><td>ALT</td><td class="num">68</td><td>U/L</td><td>7–56</td><td><span class="flag flag-h">High</span></td></tr>
<tr><td>AST</td><td class="num">41</td><td>U/L</td><td>10–40</td><td><span class="flag flag-h">High</span></td></tr></tbody></table>

<h2>Lipid Panel</h2>
<table><thead><tr><th>Analyte</th><th class="num">Result</th><th>Units</th><th>Reference range</th><th>Flag</th></tr></thead>
<tbody>
<tr><td>Total cholesterol</td><td class="num">188</td><td>mg/dL</td><td>&lt; 200</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr class="abn"><td>LDL</td><td class="num">142</td><td>mg/dL</td><td>&lt; 100</td><td><span class="flag flag-h">High</span></td></tr>
<tr><td>HDL</td><td class="num">48</td><td>mg/dL</td><td>&gt; 40</td><td><span class="flag flag-n">Normal</span></td></tr></tbody></table>

<h2>Thyroid Function</h2>
<table><thead><tr><th>Analyte</th><th class="num">Result</th><th>Units</th><th>Reference range</th><th>Flag</th></tr></thead>
<tbody>
<tr><td>TSH</td><td class="num">2.10</td><td>mIU/L</td><td>0.4–4.0</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr><td>Free T4</td><td class="num">1.1</td><td>ng/dL</td><td>0.8–1.8</td><td><span class="flag flag-n">Normal</span></td></tr></tbody></table>

<h2>Glycemic &amp; Iron Studies</h2>
<table><thead><tr><th>Analyte</th><th class="num">Result</th><th>Units</th><th>Reference range</th><th>Flag</th></tr></thead>
<tbody>
<tr class="abn"><td>HbA1c</td><td class="num">5.9</td><td>%</td><td>4.0–5.6</td><td><span class="flag flag-h">High</span></td></tr>
<tr><td>Ferritin</td><td class="num">96</td><td>ng/mL</td><td>30–400</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr class="abn"><td>Vitamin D (25-OH)</td><td class="num">22</td><td>ng/mL</td><td>30–100</td><td><span class="flag flag-l">Low</span></td></tr></tbody></table>

<h2>Urinalysis</h2>
<table><thead><tr><th>Parameter</th><th class="num">Result</th><th>Reference</th><th>Flag</th></tr></thead>
<tbody>
<tr><td>Appearance</td><td class="num">Clear</td><td>Clear</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr><td>Protein</td><td class="num">Negative</td><td>Negative</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr><td>Glucose</td><td class="num">Negative</td><td>Negative</td><td><span class="flag flag-n">Normal</span></td></tr></tbody></table>

<h2>Coagulation</h2>
<table><thead><tr><th>Analyte</th><th class="num">Result</th><th>Units</th><th>Reference range</th><th>Flag</th></tr></thead>
<tbody>
<tr><td>PT</td><td class="num">12.4</td><td>s</td><td>11.0–13.5</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr><td>INR</td><td class="num">1.05</td><td>—</td><td>0.9–1.1</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr><td>aPTT</td><td class="num">31</td><td>s</td><td>25–35</td><td><span class="flag flag-n">Normal</span></td></tr></tbody></table>

<h2>Cardiac &amp; Inflammatory Markers</h2>
<table><thead><tr><th>Analyte</th><th class="num">Result</th><th>Units</th><th>Reference range</th><th>Flag</th></tr></thead>
<tbody>
<tr><td>Troponin I</td><td class="num">&lt;0.01</td><td>ng/mL</td><td>&lt; 0.04</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr class="abn"><td>hs-CRP</td><td class="num">4.8</td><td>mg/L</td><td>&lt; 3.0</td><td><span class="flag flag-h">High</span></td></tr>
<tr><td>BNP</td><td class="num">42</td><td>pg/mL</td><td>&lt; 100</td><td><span class="flag flag-n">Normal</span></td></tr></tbody></table>

<h2>Historical Trend — ALT (U/L)</h2>
<table><thead><tr><th>Date</th><th class="num">Result</th><th>Reference</th><th>Flag</th></tr></thead>
<tbody>
<tr><td>16 Jan 2026</td><td class="num">44</td><td>7–56</td><td><span class="flag flag-n">Normal</span></td></tr>
<tr><td>17 Apr 2026</td><td class="num">57</td><td>7–56</td><td><span class="flag flag-h">High</span></td></tr>
<tr class="abn"><td>16 Jul 2026</td><td class="num">68</td><td>7–56</td><td><span class="flag flag-h">High</span></td></tr></tbody></table>
<p class="muted" style="font-size:.85rem">ALT has trended upward over six months (44 → 57 → 68 U/L), warranting follow-up.</p>

<div class="interp"><strong>Interpretation.</strong> Mildly elevated transaminases (ALT/AST) with a leukocytosis and borderline-low potassium. LDL is above target and HbA1c is in the pre-diabetic range (5.9%). hs-CRP is mildly elevated, suggesting low-grade inflammation; cardiac and coagulation studies are within range. Vitamin D is insufficient at 22 ng/mL. Thyroid function and urinalysis are unremarkable. Findings are non-specific; correlate clinically. Suggest repeat metabolic panel in 2–4 weeks, review of hepatotoxic medications, dietary lipid and glycemic counselling, and vitamin-D supplementation. Potassium of 3.2 mmol/L is mildly low — consider supplementation if symptomatic.</div>
<h2>Specimen &amp; Methodology</h2>
<table><thead><tr><th>Panel</th><th>Specimen</th><th>Method</th></tr></thead>
<tbody>
<tr><td>CBC</td><td>EDTA whole blood</td><td>Automated flow cytometry</td></tr>
<tr><td>CMP / Lipid</td><td>Serum</td><td>Spectrophotometry</td></tr>
<tr><td>Thyroid / Cardiac</td><td>Serum</td><td>Chemiluminescent immunoassay</td></tr>
<tr><td>HbA1c</td><td>Whole blood</td><td>HPLC</td></tr>
<tr><td>Urinalysis</td><td>Random urine</td><td>Dipstick + microscopy</td></tr></tbody></table>

<h2>Critical-Value Policy</h2>
<p style="font-size:.9rem">No results in this report met critical-value thresholds requiring immediate telephone notification. Values flagged <span class="flag flag-h">High</span> or <span class="flag flag-l">Low</span> are outside the reference range but not critical. Critical values (per laboratory policy) are called to the ordering provider within 30 minutes of verification.</p>

<div class="disclaimer"><strong>Methodology &amp; disclaimer.</strong> Analyzed on a certified clinical chemistry platform; reference ranges are method- and population-specific and may differ between laboratories. This report is intended for the ordering clinician and does not constitute a diagnosis. Results should be interpreted in the context of the patient's history and presentation. Specimen integrity was acceptable; no interference flags were raised.</div>`;

const marketing = `
<div class="hero"><h1>Ship documents that never lie.</h1>
<p>Scribe turns your data into polished, on-brand reports, invoices, and decks — grounded, fidelity-checked, and print-ready in one command.</p>
<a class="cta">Start free</a>&nbsp;&nbsp;<a href="#" style="font-weight:600">See a live sample →</a></div>

<h2 class="center">Everything you need to publish with confidence</h2>
<div class="features">
<div class="feature"><div class="ico">🎨</div><h3>10 design profiles</h3><p class="muted">Report, invoice, legal, clinical, résumé, and more — each honest to its industry, all consistent with your brand.</p></div>
<div class="feature"><div class="ico">🔒</div><h3>Zero fabricated data</h3><p class="muted">Every number is verified against your source. If the model invents a figure, we catch it and fix it — automatically.</p></div>
<div class="feature"><div class="ico">📄</div><h3>Any format</h3><p class="muted">PDF, DOCX, XLSX, PPTX, HTML. Author once; export everywhere, print-perfect.</p></div>
<div class="feature"><div class="ico">⚡</div><h3>One command</h3><p class="muted">No templating gymnastics. Point it at your data, pick a profile, done in seconds.</p></div>
<div class="feature"><div class="ico">🌗</div><h3>Print-first, always light</h3><p class="muted">Documents render white and print-clean by default — no dark-mode surprises on the printer.</p></div>
<div class="feature"><div class="ico">🧩</div><h3>Your house style</h3><p class="muted">Bring a reference design and Scribe reproduces it, re-grounded in your data.</p></div></div>

<div class="statsband"><div class="s"><div class="big">10</div><div class="l">design profiles</div></div><div class="s"><div class="big">0</div><div class="l">fabricated figures</div></div><div class="s"><div class="big">7</div><div class="l">export formats</div></div><div class="s"><div class="big">92%</div><div class="l">fewer errors</div></div></div>

<h2 class="center">How it works</h2>
<div class="features">
<div class="feature"><div class="ico">1️⃣</div><h3>Point at your source</h3><p class="muted">A spreadsheet, a markdown brief, a folder of notes — anything.</p></div>
<div class="feature"><div class="ico">2️⃣</div><h3>Pick a profile</h3><p class="muted">Invoice? Report? Lab result? Scribe styles it honestly for the topic.</p></div>
<div class="feature"><div class="ico">3️⃣</div><h3>Publish, verified</h3><p class="muted">Get a grounded, print-ready document with every number checked.</p></div></div>

<h2 class="center">Loved by teams who can't afford to be wrong</h2>
<div class="features">
<div class="feature"><p>"Our monthly board pack used to take a day. Now it takes a coffee — and I trust the numbers."</p><p class="muted"><strong>— Priya N., Head of Finance</strong></p></div>
<div class="feature"><p>"The fidelity check caught a transposed figure before it reached a client. That alone paid for it."</p><p class="muted"><strong>— Marco B., Agency Owner</strong></p></div>
<div class="feature"><p>"Ten profiles meant we retired ten fragile templates. Everything looks on-brand now."</p><p class="muted"><strong>— Dana K., Design Lead</strong></p></div></div>

<h2 class="center">Simple pricing</h2>
<div class="pricing">
<div class="tier"><h3>Free</h3><div class="price">$0</div><p class="muted">Core themes · HTML export</p></div>
<div class="tier popular"><h3>Pro</h3><div class="price">$12<span style="font-size:.9rem">/mo</span></div><p class="muted">All 10 profiles · charts · PDF/DOCX/XLSX</p></div>
<div class="tier"><h3>Team</h3><div class="price">$40<span style="font-size:.9rem">/mo</span></div><p class="muted">Shared house styles · SSO · priority support</p></div></div>

<h2>Frequently asked</h2>
<p><strong>Does it work offline?</strong> Yes — everything runs locally except optional model calls.</p>
<p><strong>Can I use my own model?</strong> Any model, local or hosted. Scribe is model-agnostic.</p>
<p><strong>What if the model invents a number?</strong> It won't reach your document — the fidelity check sends it back for a fix.</p>

<h2 class="center">Built for the documents you can't get wrong</h2>
<div class="features">
<div class="feature"><div class="ico">📊</div><h3>Finance</h3><p class="muted">Board packs, investor updates, statements — with every total verified against the source.</p></div>
<div class="feature"><div class="ico">🏥</div><h3>Healthcare</h3><p class="muted">Clinical summaries and lab reports that flag out-of-range values and never invent one.</p></div>
<div class="feature"><div class="ico">⚖️</div><h3>Legal &amp; Ops</h3><p class="muted">Contracts, policies, and SOPs in a sober, print-first house style.</p></div></div>

<h2 class="center">Fits your stack</h2>
<p class="center muted">Works with any model — local or hosted — and exports to the tools your team already uses. No lock-in, no external services required.</p>
<div class="statsband"><div class="s"><div class="big">MD</div><div class="l">markdown in</div></div><div class="s"><div class="big">PDF</div><div class="l">docx · xlsx · pptx</div></div><div class="s"><div class="big">100%</div><div class="l">runs locally</div></div></div>

<h2 class="center">How we compare</h2>
<table><thead><tr><th>Capability</th><th class="center">Templates</th><th class="center">Raw LLM</th><th class="center">Scribe</th></tr></thead>
<tbody>
<tr><td>Polished, on-brand design</td><td class="center">Partial</td><td class="center">Yes</td><td class="center">Yes</td></tr>
<tr><td>Grounded — no invented data</td><td class="center">Yes</td><td class="center">No</td><td class="center">Yes</td></tr>
<tr><td>Any topic / format</td><td class="center">No</td><td class="center">Yes</td><td class="center">Yes</td></tr>
<tr><td>Print-perfect &amp; light by default</td><td class="center">Varies</td><td class="center">No</td><td class="center">Yes</td></tr></tbody></table>

<h2 class="center">Security &amp; privacy</h2>
<p class="center muted">Your documents never leave your machine unless you choose a hosted model. No telemetry, no training on your data, no surprises. Bring your own keys and keep full control.</p>

<div class="hero" style="margin-top:1.6rem"><h1 style="font-size:2rem">Publish with confidence.</h1><p>Ten profiles. Seven formats. Zero fabricated figures.</p><a class="cta">Start free today</a></div>`;

const editorial = `
<div class="masthead"><span>The Chorale Review</span><span>Issue 07 · July 2026</span></div>
<h1>The quiet revolution in machine-written documents</h1>
<div class="byline">By Aria Chatterjee · Feature · 8 min read</div>

<p class="lead">For the better part of a decade, the promise of machine-authored reports came wrapped in a caveat that quietly undermined it: the documents looked convincing, and they were sometimes wrong. You could have polish or you could have certainty, the thinking went, but not both in the same file. That trade-off is finally breaking — and the fix is far less glamorous than the models that made it necessary.</p>

<p>The breakthrough is not a larger model or a cleverer prompt. It is a small, stubborn checker that reads what the model just produced and refuses to let a number through unless that number appears in the source. It sounds almost insultingly simple. It is also, by the numbers, the most consequential change to document automation in years.</p>

<p class="pull">"Polish was never the hard part. Honesty was."</p>

<h2>Why numbers were the weak point</h2>
<p>Language models are extraordinary at restructuring prose. Hand one a dense spreadsheet and it will produce a readable narrative, complete with a headline finding and a tidy recommendation. The trouble is that somewhere in that fluent retelling, a figure occasionally drifts — a 42 becomes a 47, a total is rounded into fiction, a percentage is invented to make a sentence land. Readers, trusting the confident tone, rarely catch it.</p>
<p>Prose errors are forgivable; a fabricated statistic in a board pack or a lab summary is not. The industry's early response was to make the models bigger and the prompts sterner. It helped at the margins and failed at the center, because the failure was never really about capability. It was about verification — and models are poor auditors of their own work.</p>

<h2>The checker that changed the calculus</h2>
<p>The new approach inverts the problem. Instead of asking the model to be trustworthy, it assumes the model is fallible and checks the output. Every distinctive number in the finished document is extracted and matched against the source. Anything that cannot be found is flagged and sent back for correction. Dropped numbers are fine — a report summarizes, after all — but invented ones are not.</p>
<p>In a study of 240 documents across six domains, the technique cut fabricated figures by 92 percent, with no measurable loss of readability. The most error-prone genre, unsurprisingly, was marketing copy; the cleanest was clinical reporting, where the stakes have long forced discipline.</p>

<p class="pull">"The result reads like a designer made it and an auditor signed it — a pairing that, until recently, did not exist in the same document."</p>

<h2>What it means for the rest of us</h2>
<p>The practical upshot is that a whole class of documents — invoices, statements, lab results, executive briefs — can now be generated with the same polish we expect from a design studio and the same integrity we expect from an accountant. The tooling that does this is quietly becoming infrastructure, the way spell-check did a generation ago.</p>
<p>None of this makes the models honest. It makes them <em>checked</em> — and for documents that people act on, checked is the only kind of honest that matters.</p>

<h2>The economics of trust</h2>
<p>There is a reason this shift is arriving through the back office rather than the front page. The value of a checked document is highest precisely where a mistake is expensive and a human is currently paid to catch it. Reconciliation, review, sign-off — these are the quiet, costly rituals that surround every number an organization publishes.</p>
<p>Automating the polish without automating the trust simply moved the cost, not removed it; a beautiful report still had to be checked by hand. By moving verification into the tool, the new approach collapses two steps into one. That is where the savings live, and it is why finance teams — not marketers — were the early adopters.</p>
<p>The lesson generalizes. Wherever a task pairs creative generation with a hard constraint, the winning design is not a smarter generator but a cheap, relentless checker sitting downstream of it.</p>

<h2>A brief history of getting it wrong</h2>
<p>It is worth remembering how we arrived here. The first wave of document automation was template-driven: rigid, reliable, and incapable of surprise. It never lied because it never composed. The second wave handed composition to models and discovered that composition and fabrication are close cousins. The industry spent two years trying to prompt its way out of a problem that prompting could not solve.</p>
<p>The third wave — the one now arriving quietly in accounting departments and clinical labs — accepts that the model will occasionally be wrong and simply refuses to publish the wrongness. It is a humbler design, and a more honest one.</p>
<p class="pull">"The tools that will last are the ones that assume fallibility and design around it."</p>
<h2>The human in the loop, rethought</h2>
<p>Sceptics ask whether removing the manual check simply moves the risk somewhere less visible. It is a fair question, and the honest answer is that the checker changes the human's job rather than eliminating it. Instead of hunting for transposed digits, the reviewer now adjudicates the handful of flags the tool surfaces — the genuinely ambiguous cases where a figure was derived rather than stated.</p>
<p>That is a better use of human attention. Machines are tireless at the mechanical comparison of numbers and poor at judgement; people are the reverse. The design that wins is the one that hands each party the work it is actually good at, and this is the first document tool that does so at scale.</p>

<h2>What comes next</h2>
<p>The obvious extension is from presence to provenance: not merely checking that a number appears in the source, but that it was <em>derived</em> correctly. A total that sums its line items, a percentage that divides the right two figures. That is harder, and it is where the research frontier is moving.</p>
<p>For now, though, the practical victory is real. A finance lead can generate a board pack and trust the totals. A clinician can summarize a panel and know no value was invented. That is not a small thing. It is, arguably, the difference between a novelty and an instrument.</p>
<p>The models will keep getting bigger. The checkers, mercifully, will stay small — and that asymmetry may be the most reassuring detail in the whole story.</p>

<h2>Coda: the boring future we deserve</h2>
<p>If there is a disappointment lurking in all this, it is that the fix is so unglamorous. There is no breakthrough architecture here, no emergent capability to marvel at — just a small program that reads the output and says <em>no</em> when a number does not check out. It is the software equivalent of a proofreader, and proofreaders have never trended.</p>
<p>But unglamorous is often what maturity looks like. The technologies that end up mattering are rarely the ones that dazzled; they are the ones that quietly became reliable enough to disappear into the workflow. Spell-check did it. Version control did it. Grounded generation, if the early numbers hold, is on the same path — and a decade from now we may struggle to remember that machine-written documents were ever allowed to lie.</p>

<div class="foot">The Chorale Review · Independent · Reproduction permitted with attribution. Corrections: review@chorale.dev</div>`;

const recipe = `
<h1>One-Pan Lemon &amp; Herb Roast Chicken</h1>
<p style="font-size:1.05rem">A weeknight roast that tastes like a Sunday one. Everything cooks in a single pan, the lemon and garlic melt into the juices, and the herbs crisp at the edges. Minimal washing up, maximum reward.</p>
<div class="r-meta"><span class="badge"><b>15 min</b>Prep</span><span class="badge"><b>40 min</b>Cook</span><span class="badge"><b>55 min</b>Total</span><span class="badge"><b>4</b>Servings</span><span class="badge"><b>Easy</b>Level</span></div>

<div class="cook">
<div>
<div class="ingredients"><h3>For the chicken</h3><ul>
<li>8 bone-in chicken thighs</li><li>2 lemons (1 sliced, 1 juiced)</li><li>6 cloves garlic, smashed</li><li>3 tbsp olive oil</li><li>4 sprigs thyme</li><li>2 sprigs rosemary</li><li>1 tsp flaky salt</li><li>Black pepper</li></ul></div>
<div class="ingredients" style="margin-top:1rem"><h3>To serve</h3><ul>
<li>400 g baby potatoes, halved</li><li>1 red onion, wedged</li><li>Handful parsley, chopped</li></ul></div>
</div>
<div><h3>Method</h3>
<ol class="steps">
<li>Heat the oven to 200°C (fan 180°C). Pat the chicken thighs very dry — dry skin is crisp skin — and season generously with salt and pepper on both sides.</li>
<li>In a cold oven-proof pan, arrange the thighs skin-side down with a tablespoon of the oil. Set over medium heat and let them render and go deep golden, about 8 minutes. Don't move them.</li>
<li>Flip the thighs. Tuck the potatoes, onion wedges, smashed garlic, and lemon slices around them. Drizzle with the remaining oil and the lemon juice.</li>
<li>Scatter the thyme and rosemary over the top and transfer the pan to the oven.</li>
<li>Roast for 30–35 minutes, until the potatoes are tender and the chicken registers 74°C at the thickest part.</li>
<li>Rest the pan for 5 minutes off the heat. The juices will settle and thicken slightly.</li>
<li>Spoon the pan juices over everything, shower with parsley, and serve straight from the pan.</li>
</ol>
<div class="tip"><strong>Tip.</strong> Save any leftover lemon-herb fat in a jar — it makes an outstanding salad dressing or a base for roasting vegetables later in the week.</div>
<div class="tip"><strong>Make it a meal.</strong> A simple green salad and crusty bread to mop the juices is all you need.</div>
</div></div>

<h2>Nutrition (per serving, approx.)</h2>
<table><thead><tr><th>Energy</th><th>Protein</th><th>Fat</th><th>Carbs</th></tr></thead>
<tbody><tr><td>520 kcal</td><td>38 g</td><td>32 g</td><td>18 g</td></tr></tbody></table>
<h2>Variations &amp; storage</h2>
<p><strong>Swap the herbs</strong> for oregano and a pinch of chili for a warmer profile. <strong>No thighs?</strong> Drumsticks work; add 5 minutes. <strong>Storage:</strong> keeps 3 days refrigerated; reheat uncovered at 180°C to re-crisp the skin.</p>

<h2>Why this works</h2>
<p>Three small decisions do most of the heavy lifting. Starting the thighs skin-side down in a cold pan renders the fat slowly, so the skin dries and crisps instead of seizing. Roasting everything together lets the potatoes soak up the rendered chicken fat and lemon, which is where the flavour concentrates. And resting the pan off the heat lets the juices thicken into something you'll want to spoon over every bite.</p>
<p>None of it is fussy. The recipe is forgiving on timing and quantities — an extra clove of garlic or a few more minutes in the oven won't hurt it — which is exactly what you want on a weeknight.</p>

<h2>Equipment</h2>
<p>You need one good oven-proof pan — cast iron is ideal because it holds heat and moves from stovetop to oven without complaint. A pair of tongs, a sharp knife, and a meat thermometer round out the list. Nothing here is special; the recipe is designed to reward the pan you already own.</p>

<h2>Make it a menu</h2>
<div class="cook"><div class="ingredients"><h3>Serve with</h3><ul><li>A sharp green salad</li><li>Crusty sourdough</li><li>Buttered greens or peas</li><li>A crisp, unoaked white wine</li></ul></div>
<div><h3>Timing plan</h3><ol class="steps"><li>Start the chicken searing while the oven heats.</li><li>While it roasts, make the salad and warm the bread.</li><li>Rest the chicken; toss the salad; pour the wine. Serve.</li></ol></div></div>

<h2>Cook's notes &amp; FAQ</h2>
<div class="tip"><strong>Why start in a cold pan?</strong> Rendering the fat from a cold start yields crisper, more evenly golden skin than dropping the thighs into a screaming-hot pan.</div>
<div class="tip"><strong>Can I prep ahead?</strong> Season the chicken and store it uncovered in the fridge for up to a day — the drier the skin, the crisper the result.</div>
<div class="tip"><strong>Is it gluten-free?</strong> Yes, as written. Serve with a gluten-free side and it stays that way.</div>
<p style="margin-top:1rem"><strong>Scaling.</strong> The recipe doubles happily across two pans; don't crowd a single pan or the chicken will steam instead of crisp. Keep the oven at 200°C and rotate the pans halfway.</p>

<h2>Make it twice: Lemon Chicken Orzo</h2>
<p>Leftovers become a second dinner with almost no effort. Shred any remaining chicken and set the pan juices aside.</p>
<div class="cook"><div class="ingredients"><h3>You'll need</h3><ul><li>Leftover chicken, shredded</li><li>200 g orzo</li><li>Reserved pan juices</li><li>500 ml chicken stock</li><li>Handful spinach</li><li>Grated parmesan</li></ul></div>
<div><h3>Method</h3><ol class="steps"><li>Toast the orzo in the reserved juices for 2 minutes until fragrant.</li><li>Add the stock a ladle at a time, stirring, until the orzo is tender — about 10 minutes.</li><li>Fold through the shredded chicken and spinach until the spinach wilts.</li><li>Off the heat, stir in parmesan and a squeeze of lemon. Serve at once.</li></ol></div></div>
<div class="tip"><strong>Tip.</strong> A splash of the pan juices is the secret here — it carries all the roasted lemon-and-garlic flavour straight into the orzo.</div>

<h2>Substitutions</h2>
<table><thead><tr><th>Ingredient</th><th>Swap</th><th>Notes</th></tr></thead>
<tbody>
<tr><td>Chicken thighs</td><td>Drumsticks or bone-in breast</td><td>Add 5 min for drumsticks; watch breast for dryness.</td></tr>
<tr><td>Baby potatoes</td><td>New potatoes or fingerlings</td><td>Halve larger potatoes so they cook evenly.</td></tr>
<tr><td>Thyme &amp; rosemary</td><td>Oregano, sage, or bay</td><td>Woody herbs hold up best to the oven.</td></tr>
<tr><td>Lemon</td><td>Preserved lemon (halved)</td><td>Reduce added salt — preserved lemon is salty.</td></tr></tbody></table>

<h2>Storage &amp; reheating</h2>
<p>Cool leftovers quickly and refrigerate within two hours; they keep for three days. To reheat and keep the skin crisp, use a hot oven (180°C) uncovered for 10–12 minutes rather than a microwave, which softens the skin. The dish freezes for up to two months, though the potatoes are best eaten fresh. Thaw overnight in the fridge before reheating.</p>`;

const techdoc = `
<h1>Documents API</h1>
<p>Read, create, and convert documents in any supported format. This reference covers the four core operations and their parameters.</p>
<div class="toc"><h3>On this page</h3><a href="#auth">Authentication</a><a href="#read">read_doc</a><a href="#write">write_doc</a><a href="#convert">convert</a><a href="#errors">Error codes</a><a href="#limits">Rate limits</a></div>

<h2 id="auth">Authentication</h2>
<p>All requests require a bearer token in the <code>Authorization</code> header. Tokens are workspace-scoped.</p>
<pre><code>Authorization: Bearer sk_live_...</code></pre>
<div class="adm info"><div class="t">Info</div>Tokens never expire but can be revoked from the dashboard. Treat them like passwords.</div>

<h2 id="read">read_doc</h2>
<p><span class="method m-get">GET</span> <code>read_doc(path)</code> — extract text or Markdown from a document. Spreadsheets are returned as Markdown tables; images are OCR'd.</p>
<table><thead><tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
<tbody>
<tr><td><code>path</code></td><td><code>string</code></td><td>Yes</td><td>Workspace-relative path to the document.</td></tr>
</tbody></table>
<p><strong>Example</strong></p>
<pre><code>const { content, format } = await read_doc({ path: "report.pdf" });
// content: extracted text · format: "pdf"</code></pre>

<h2 id="write">write_doc</h2>
<p><span class="method m-post">POST</span> <code>write_doc(path, content, theme?, charts?)</code> — create a document from Markdown. The output format is chosen by the file extension.</p>
<table><thead><tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
<tbody>
<tr><td><code>path</code></td><td><code>string</code></td><td>Yes</td><td>Output path (.pdf / .docx / .html / .md).</td></tr>
<tr><td><code>content</code></td><td><code>string</code></td><td>Yes</td><td>Markdown source.</td></tr>
<tr><td><code>theme</code></td><td><code>string</code></td><td>No</td><td>Design profile <span class="tag-dep">optional</span> — report, invoice, legal, …</td></tr>
<tr><td><code>charts</code></td><td><code>boolean</code></td><td>No</td><td>Render numeric tables as bar charts.</td></tr>
</tbody></table>
<div class="adm warn"><div class="t">Warning</div>Binary output (PDF/DOCX) cannot be edited after creation — regenerate from source instead.</div>
<pre><code>await write_doc({ path: "q3.pdf", content: brief, theme: "report", charts: true });</code></pre>

<h2 id="convert">convert</h2>
<p><span class="method m-put">PUT</span> <code>convert(from, to, theme?)</code> — convert a file to another format in one step. HTML sources render faithfully; Markdown sources use the chosen theme.</p>
<div class="adm tip"><div class="t">Tip</div>Press <kbd>Ctrl</kbd> + <kbd>P</kbd> on any generated HTML to print it to PDF with identical styling.</div>
<pre><code>await convert({ from: "notes.md", to: "notes.pdf", theme: "report" });
await convert({ from: "data.csv",  to: "data.xlsx" });</code></pre>

<h2 id="errors">Error codes</h2>
<table><thead><tr><th>Code</th><th>Meaning</th><th>Fix</th></tr></thead>
<tbody>
<tr><td><code>400</code></td><td>Unsupported format</td><td>Check the file extension is supported.</td></tr>
<tr><td><code>403</code></td><td>Path escapes workspace</td><td>Use a path inside the workspace root.</td></tr>
<tr><td><code>413</code></td><td>File too large</td><td>Files must be under 25 MB.</td></tr>
</tbody></table>

<h2 id="limits">Rate limits</h2>
<p>The API allows <strong>120</strong> requests per minute per token. Conversions that spawn a browser count as <strong>2</strong>. Exceeding the limit returns <code>429</code> with a <code>Retry-After</code> header.</p>

<h2>Pagination</h2>
<p>List endpoints return at most <strong>50</strong> items per page. Use the <code>cursor</code> from the response to fetch the next page; an empty <code>cursor</code> signals the end.</p>
<pre><code>let cursor = null;
do {
  const page = await list_docs({ cursor });
  process(page.items);
  cursor = page.cursor;
} while (cursor);</code></pre>

<h2>Webhooks</h2>
<p>Register a URL to receive events when long-running conversions finish. Payloads are signed; verify the <code>X-Chorale-Signature</code> header before trusting a request.</p>
<table><thead><tr><th>Event</th><th>Fires when</th></tr></thead>
<tbody>
<tr><td><code>doc.created</code></td><td>A document finished rendering.</td></tr>
<tr><td><code>doc.failed</code></td><td>A conversion errored (payload includes the code).</td></tr>
</tbody></table>
<div class="adm info"><div class="t">Info</div>Webhooks retry with exponential backoff for up to 24 hours until your endpoint returns 2xx.</div>

<h2>SDKs &amp; quickstart</h2>
<p>Official SDKs are available for Node and Python. Install and generate your first document in under a minute:</p>
<pre><code>import { Chorale } from "chorale";
const c = new Chorale(process.env.CHORALE_KEY);
await c.write_doc({ path: "hello.pdf", content: "# Hello", theme: "report" });</code></pre>

<h2>Versioning</h2>
<p>The API is versioned by date. Pin a version with the <code>Chorale-Version</code> header (e.g. <code>2026-07-01</code>). Breaking changes ship under a new version; additive changes do not. <span class="tag-dep">deprecated</span> fields are supported for at least six months after announcement.</p>`;

export const DEMOS: Record<string, string> = {
  executive, academic, legal, invoice, resume, clinical, marketing, editorial, recipe, techdoc,
};

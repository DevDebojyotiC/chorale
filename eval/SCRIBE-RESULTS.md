# Scribe (Files/Docs specialist) — full capability coverage

The `scribe` generates, edits, summarizes, and organizes a project's documents — grounded strictly in the
real files. **Every capability in the design spec is now covered by an objective, self-validated benchmark**
(graders in [`scribe-fixtures.ts`](scribe-fixtures.ts), validated with no model calls by
[`scribe-selftest.ts`](scribe-selftest.ts)).

Run: `npx tsx eval/scribe-bench.ts [ground|stale|edit|gen|text|reorg|all] ["<model>" …]`.

## Coverage matrix — ✅ = verified by benchmark on the default model (gemma-4-31B)
| # | Capability | Status | Suite |
|---|------------|--------|-------|
| 1 | README generation | ✅ | ground |
| 1 | API / reference docs | ✅ | gen |
| 1 | CHANGELOG (from commits) | ✅ | gen |
| 1 | Inline docstrings (JSDoc) | ✅ | gen |
| 1 | Architecture doc | ✅ | gen |
| 1 | Scaffolding (CONTRIBUTING) | ✅ | gen |
| 2 | Summarization fidelity | ✅ | text |
| 2 | Extraction (action items) | ✅ | text |
| 2 | Structured extraction (table) | ✅ | text |
| 2 | Multi-doc synthesis | ✅ | gen |
| 3 | Proofread + **preserve facts** | ✅ | edit |
| 3 | Formatting normalization | ✅ | gen |
| 3 | Restructure / TOC | ✅ | gen |
| 3 | Tone / style rewrite | ✅ | text |
| 4 | Staleness detection | ✅ | stale |
| 4 | Sync-apply (fix stale doc) | ✅ | gen |
| 4 | Cross-doc consistency | ✅ | gen |
| 4 | Example validation | ✅ | text |
| 4 | Link / reference integrity | ✅ | ground + stale |
| 5 | Reference-safe move | ✅ | unit + reorg |
| 5 | Reorganize (multi-file) | ✅ | reorg |
| 5 | Docs index / inventory | ✅ | gen |
| 5 | Naming conventions | ✅ | reorg |
| 6 | Local grounded Q&A (cited) | ✅ | text |
| 7 | `groundCheck` — paths **+ symbols + scripts** | ✅ | mechanism + unit |
| 7 | Meaning-preservation (edits) | ✅ | mechanism + unit |
| 7 | `selfCritique` | ✅ | mechanism |

**On gemma (the default model) every one of the 22 benchmarked capability checks passes.**

## The verification layer (area 7) — delivered in full
- **`groundCheck` (anti-hallucination)** now checks **paths, code symbols, and npm scripts**: a backticked
  `frobnicate()` that's in no file, or a `npm run deploy` that isn't a package.json script, is flagged and
  looped back — not just missing file links. Conservative (0 false positives on real generated docs).
- **Meaning-preservation** — edit tools snapshot each file's original content; any technical fact (number,
  backticked token, URL) present before an edit but gone after is flagged. It's **intent-aware and one-shot**:
  it nudges once and lets the model keep an *intended* change (e.g. a version bump) while restoring an
  *accidental* drop — so it protects proofreading edits without fighting sync/update tasks.
- **`selfCritique`** is agent-agnostic (re-verify your claims against the files, per your own rules).

## Model note (honest)
gemma-4-31B (default): **100% — all capabilities green.** gpt-oss-120B (escalation): precision, auditing,
editing, and all answer-text tasks are solid, but it is flappier at **creating a new file from scratch**
(skipped a README and an ARCHITECTURE.md in one full run) and once spelled a number out (`3` → "three") in an
edit. Same pattern as the reviewer: the cheap, fast default model is the more reliable choice; escalation adds
little for doc work. N is small.

## Document formats — read · create · convert (beyond plain text)
The scribe handles real binary/office/web formats through deterministic tools (`read_doc`, `write_doc`,
`write_sheet`, `convert`) — the model authors Markdown/rows, the tools do the binary I/O. Benchmarked by
**round-trip** (`eval/scribe-formats.ts`): produce a file → read it back → the content survived.

| Op | Formats | gemma (default) | gpt-oss |
|----|---------|-----------------|---------|
| **Create** | XLSX · DOCX · PDF · PPTX | **4/4** | 3/4 (PPTX flaky) |
| **Read/extract** | XLSX · PDF · DOCX · **image (OCR)** | **4/4** | 3/4 (OCR read flaky) |
| **Convert** | md→pdf · csv→xlsx · docx→md | **3/3** | **3/3** |

**gemma: 11/11.** PDF creation renders via headless Chrome/Edge for fidelity (26 KB rendered PDFs), with a
pure-JS pdfkit fallback. Images are OCR'd via tesseract.js (model-agnostic — works even on text-only gemma).
Also supported by the same tools: HTML, CSV/TSV, JSON/YAML/TOML. Libraries: exceljs, mammoth, docx (via
html-to-docx), pdf-parse, pdfkit, marked, pptxgenjs, officeparser, tesseract.js — `npm audit` stays **0**.

gpt-oss (escalation) is flappier at *creating* a new file (missed PPTX) and one OCR read — the same pattern
as everywhere: the default model is the reliable one. Unit tests round-trip every format deterministically
(`test/documents.test.ts`); OCR is verified via a committed fixture + this benchmark (tesseract needs a
one-time language-data download, so it's excluded from the offline unit suite).

## Design & presentation quality (matching / beating a bespoke report)
Beyond correct conversion, the scribe produces *good-looking* documents, in three tiers
(`eval/scribe-design.ts` scores richness on an 8-feature checklist; `scribe-design-bench.ts` runs the
model-authored mode):

1. **Professional themes** (`theme: report|docs|minimal` on `write_doc`/`convert`) — deterministic CSS:
   gradient cover title, design-token colors, styled tables (colored header + zebra), callouts, print
   styles, dark mode. **`report` = 7/8**, vs the reference Claude report **6/8** (scribe adds print + dark).
2. **Data visualization** (`charts: true`) — numeric Markdown tables become inline CSS bar charts, grounded
   to the real values. **`report + charts` = 8/8**, exceeding the Claude report on every checklist feature.
3. **Bespoke design mode** — the *model* authors custom HTML/CSS for a specific document (Claude's approach),
   but with scribe's edge preserved: an automatic **fidelity check** (`checkDesignFidelity`) verifies the
   bespoke artifact **invents no data** — every number in it must exist in the source. Live benchmark:
   gemma **7/8 richness**, gpt-oss **6/8**, **both with 0 fabricated numbers → PASS**.

The positioning made concrete: a generic converter loses to a bespoke design; a bespoke design (Claude) isn't
verified against a source of truth. Scribe does **both** — presentation polish *and* a grounded, no-fabrication
guarantee.

### Topic design profiles (visually distinct, honest to the industry)
Beyond `report`/`docs`, scribe has **10 topic profiles** (`src/tools/doc-profiles.ts`) so a document reads honestly
as its type — chosen by `theme:` or inferred from content. Each shares one **light, print-friendly** base (for
consistency) but has its own palette, type, and signature components:

| Profile | Palette · type · signature component |
|---------|--------------------------------------|
| `executive` | navy + bronze on cream · serif headings · exec-summary + exhibits + bottom-line |
| `academic` | black-on-white · full serif · title/abstract + two-column + figure captions + refs |
| `legal` | black-on-white · serif · hierarchical clause numbering + defined terms + signature blocks |
| `invoice` | teal + mono numerals · sans · bill-to + right-aligned line items + totals block + due badge |
| `resume` | teal + grayscale · sans · contact bar + two-column + skill bars + dated timeline |
| `clinical` | clinical blue · sans · patient header + reference-range column + H/L flags (red/amber) |
| `marketing` | vibrant purple/pink · bold sans · hero + CTA + feature cards + stats band + pricing |
| `editorial` | warm neutral · serif · masthead + byline + drop cap + pull quotes |
| `recipe` | terracotta/olive · serif headings · time/servings badges + ingredient checklist + numbered steps |
| `techdoc` | indigo/slate · sans + mono · TOC + admonitions + HTTP-method badges + params + `<kbd>` |

Demos: `docs/scribe-profile-*.html` (all light, all with their distinctive components). A unit test asserts every
profile registers, renders light, and carries its signature component.

### Topic-aware document length
Documents are sized to their topic, not one-size-fits-all (`src/tools/doc-pages.ts`): an **invoice defaults to 1 page**,
a **medical report to 3–4**, an **academic paper/thesis to 12+**, etc. `resolvePageTarget(topic, requested?)` returns the
target; a **user-specified count always overrides** the default (`parsePageRequest` reads "5 pages" / "two-page" /
"10-page" from plain instructions). Scribe authors content to the target and can verify by rendering to PDF and counting
pages — adjusting depth/detail, never padding with filler.

## Caveats
Small fixtures, small N. Content graders use term coverage + structure regexes + the groundedness checker;
they verify *correctness signals* (right facts present, nothing invented, right structure), not subjective
prose quality (elegance of tone).

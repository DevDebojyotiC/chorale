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

## Caveats
Small fixtures, small N. Content graders use term coverage + structure regexes + the groundedness checker;
they verify *correctness signals* (right facts present, nothing invented, right structure), not subjective
prose quality (elegance of tone).

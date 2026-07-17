# Project State

A snapshot of what exists and works right now. Refreshed at the completion of every phase, before shipping.

> **Version:** 0.2.0 (Phase 3 shipped) · **Phase:** 4 in progress (Core Agents) · **Tests:** 141 passing · **Last updated:** Phase 4 Task 2 (scribe / files-docs agent landed).

## Status at a glance
- **Runtime:** model-agnostic, production coder pipeline (salvage + verify + self-heal + diagnose-and-compensate + a **reviewer review-gate**), fallback chain with per-request timeout + retry/backoff.
- **Agents:** `coder` (verify/fewShot/selfHeal/reviewGate on), `research`, `orchestrator`, `general`, `reviewer` (structured code review), `scribe` (files/docs incl. **PDF/DOCX/XLSX/PPTX/HTML/CSV + image-OCR**: read·create·convert, grounded). 6 agents.
- **Skills:** Claude-compatible SKILL.md with progressive disclosure (1 shipped). **MCP:** client connects any MCP server.
- **Persistence:** SQLite sessions/messages/usage (WAL); per-session run transcripts; secret-redacted logs.
- **CLI:** `init · agents · doctor · profiles · sessions [rm|prune] · cost`, plus a turn (stdin or arg, `--json`, `--verbose/--quiet`, `--model/--agent/--profile/--resume/-c`, permission flags).

## Recommended models (from the Phase-2 benchmarks)
| Role | Model | Why |
|------|-------|-----|
| **Default heavy tier** | `hf:google/gemma-4-31B-it` | 9–10/10 on ramps, perfect on routine multi-file work, fastest, ≈$0. Full-stack now reliable after compensation. |
| **Escalation** | `fireworks:…/gpt-oss-120b` | Cheapest 10/10 (~$0.013), 100% across real-engineering trials incl. full-stack. |
| **Local (constrained VRAM)** | `ollama:qwen2.5-coder:3b` | Runs on 4 GB; salvage makes its text tool-calls work. |
| Not worth the premium here | GLM-5.2, Kimi-K2.6, DeepSeek-V4-Pro, MiniMax-M3 | Same scores as the escalation pick at 3–20× the cost. |

Full evidence: [`model-evaluation-report.md`](model-evaluation-report.md), [`engineering-benchmark-report.md`](engineering-benchmark-report.md), [`RAMP-LEADERBOARD` (eval)](../eval/RAMP-LEADERBOARD.md).

## What works (verified)
- Fallback chain, salvage, verify-repair, self-heal, diagnose-and-compensate (unit + live tested).
- Gemma full-stack: **20/20** after compensation (was 7/10). gpt-oss-120B: 100% across Tier-2 trials.
- `chorale doctor`: ollama / fireworks / hf reachable; `chorale cost`: per-model spend; transcripts written & redacted.

## Known limitations / not done
- **`selfLearn`** v1 is **live** (Phase 3, Task 1): learns fixes from successful repairs, injects them proactively; `chorale lessons` to inspect. v2 (LLM reflection for novel failures) is future work.
- Benchmarks are self-contained projects (up to a full-stack app), **not thousand-line codebases**; N is small on the hardest tiers.
- **TUI shipped** (`chorale tui` — Ink streaming chat REPL); the React/Ink TSX is excluded from `npm run typecheck` (native TS7 crashes on React types) but is type-transpiled by `npm run build`.
- **Reviewer agent shipped** (Phase 4, Task 1): read-only structured code review, hardened with the **four mechanisms** (per-model compensation, few-shot, self-heal via a self-critique pass, self-learn). Benchmarked across 5 suites — ramp **10/10**, precision **9/9**, multi **8/8**, polyglot **3/3**, expert security **3/3** (gemma, single-pass; see [`eval/REVIEWER-SUITES.md`](../eval/REVIEWER-SUITES.md)). Self-critique is a guarded recall safety net (recovered gpt-oss 2→3, never drops a security finding). Also does **diff review** (`chorale review`), **multi-file cross-contract** review (reads files via tools, 3/3), and is **auto-wired into the coder as a review gate** (semantic second opinion after verify — live demo caught SQLi + a missing `await` and drove the fix). Files/docs, planner, test-writer, productivity agents still to come.
- **Scribe agent shipped** (Phase 4, Task 2): files/docs specialist — **every capability in the spec is benchmark-verified green on gemma** (22 checks: README/API/CHANGELOG/docstrings/architecture/scaffolding gen; summarize/extract/structured/synthesis; proofread/format/TOC/tone edits; staleness detect + sync-apply + consistency + example-validation; reference-safe move + reorganize + inventory + naming; grounded Q&A). Verification layer: `groundCheck` (paths **+ symbols + scripts**), intent-aware **meaning-preservation** on edits, `selfCritique`. **Multi-format document I/O** (tools `read_doc`/`write_doc`/`write_sheet`/`convert`): read·create·convert PDF/DOCX/XLSX/PPTX/HTML/CSV + image-OCR — gemma 11/11 on the round-trip format benchmark (PDF via headless Chrome/Edge + pdfkit fallback; OCR via tesseract.js). See [`eval/SCRIBE-RESULTS.md`](../eval/SCRIBE-RESULTS.md). gpt-oss (escalation) is flappier at *creating* new files.
- Research falls back to brittle DuckDuckGo scraping without a Tavily key (degrades gracefully, but Tavily recommended).

## Quality gates
- `npm run typecheck` (tsc, strict; `src/tui` excluded — native TS7 crashes on React types) · `npm test` (vitest, 141) · CI on push (`.github/workflows/ci.yml`).
- Graders self-validated against known-good/bad reference solutions before any benchmark run.
- **Security:** no secrets/absolute paths/`.env`/`data/` in tracked files; SQL is parameterized; shell has a catastrophic-command denylist; logs are secret-redacted. `npm audit` reports **0 vulnerabilities** (`overrides` pin `esbuild` and `uuid` to patched versions) and runs in CI. `selfHeal` runs model-written code — see [`SECURITY.md`](../SECURITY.md).

## Next (Phase 4 — Core Agents)
Done: **Task 1 — reviewer** (structured code review) · **Task 2 — scribe** (files/docs) · **Task 3 — planner/architect** (grounded validate-repaired plans + a generalized composable **gate** framework + plan-first wiring; plus the **fullstack levers** — plan-execution-across-turns, shared contract, runnability gate, escalation — see [`FULLSTACK-EXPERIMENT.md`](FULLSTACK-EXPERIMENT.md)) · **Task 4 — test-writer** (writes+runs tests, **mutation-graded**; see [`eval/TESTWRITER-RESULTS.md`](../eval/TESTWRITER-RESULTS.md)). Remaining: **5** productivity (email/calendar/notes via MCP) — then a larger real-world codebase benchmark. GUI is Phase 5. See [`ROADMAP.md`](ROADMAP.md). **210 tests.**

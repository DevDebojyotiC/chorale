# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Phase 3 (shipped) + Phase 4 (in progress, branch `phase-4`)

### Added
- **Self-learning (`selfLearn`)** — the coder records fixes from its own successful diagnosed repairs (`data/lessons.sqlite`, per agent) and injects the top proven lessons proactively on future runs. `chorale lessons [agent]` to inspect; `CHORALE_NO_LEARN=1` disables it for reproducible benchmarks. Every `diagnose` rule now carries a stable category key.
- **Ink TUI (`chorale tui`)** — interactive streaming chat REPL; `runAgent` gained `onToken`/`onEvent` renderer hooks. *(The React/Ink TSX is excluded from `npm run typecheck` due to a native-TS7 compiler crash on React types; it is type-transpiled by `npm run build`.)*
- **Reviewer agent** (Phase 4, Task 1) — read-only code review that emits severity-tagged findings (`BLOCKER`/`MAJOR`/`MINOR`/`NIT`) with `file:line` + fix + a `VERDICT`; inspection tools only (never mutates), delegable, optional `bash` verification. Hardened with the four robustness mechanisms — per-model compensation (security vuln-class checklist + a ReDoS safe-vs-dangerous criterion + a calibration rule), **few-shot** (held-out exemplars), **self-heal** via a `selfCritique` second pass (`CHORALE_NO_CRITIQUE=1` to disable), and **self-learn**. Benchmarked across 5 suites (`eval/reviewer-*.ts`, `REVIEWER-SUITES.md`): ramp 10/10 · precision 9/9 · multi 8/8 · polyglot 3/3 · expert-security 3/3 on the ≈$0 default model.
- **`selfCritique` agent toggle** — a general self-critique second pass (an agent re-examines and corrects its own output before returning); default-on for the `reviewer`, opt-in elsewhere.
- **`chorale review [--staged] [paths…]`** — review your `git diff` (working tree or index) or given files with the reviewer agent. The reviewer gained a diff-review mode (judge the change, catch regressions) and multi-file cross-contract review (reads files via its tools).
- **`reviewGate` agent toggle** — after a coding agent's code verifies clean, the `reviewer` gives a semantic second opinion and any BLOCKER/MAJOR loops back for a fix. Default-on for the `coder` (catches security/logic/async bugs syntax+smoke miss); `CHORALE_NO_REVIEW_GATE=1` to disable.
- **Scribe agent** (Phase 4, Task 2) — a files/docs specialist: grounded generation (README/API/CHANGELOG), summarize/extract, meaning-preserving edits, staleness detection, and applied file organization. New reference-safe **`move`** fs tool (renames/moves within the sandbox, reports links to update, never deletes) and a **`groundCheck`** anti-hallucination pass (`src/core/ground.ts`) that verifies referenced paths exist. Benchmarked (`eval/scribe-*.ts`, `SCRIBE-RESULTS.md`): on gemma, 0 invented refs · recall 2/2 · staleness 3/3 · edit-safety ✓.
- **`groundCheck` agent toggle** + **agent-agnostic self-critique** — the shared `selfCritique` prompt is no longer reviewer-specific, so it works for the scribe (and any agent) without derailing them, while keeping the reviewer un-regressed.
- **Multi-format document I/O for the scribe** — new tools `read_doc` / `write_doc` / `write_sheet` / `convert` let it read, create, and convert **PDF, DOCX, XLSX, PPTX, HTML, CSV/TSV, JSON**, and **images (OCR)**. The model authors Markdown/rows; deterministic tools do the binary I/O (exceljs, mammoth, docx via html-to-docx, pdf-parse, pdfkit, marked, pptxgenjs, officeparser, tesseract.js). PDF renders via headless Chrome/Edge with a pdfkit fallback. Round-trip benchmark: gemma 11/11. `npm audit` stays 0 (`uuid` pinned via overrides).

### Changed
- **Package manager pnpm → npm** — removed the pnpm lockfile/`packageManager` field, pinned deps, and added an `esbuild` override so `npm audit` reports 0 vulnerabilities; CI runs on `npm ci`.

### Fixed
- **Session recency ordering** — `latestSession`/`listSessions`/`pruneSessions` tie-broke arbitrarily when sessions shared a millisecond `updated_at`; added a monotonic `rowid` secondary sort (resolved a CI-only flake).

## [0.2.0] — Phase 2

A production **coder**, evidence-backed model routing, and a full hardening pass. Per-commit detail: [`docs/COMMIT-LOG.md`](docs/COMMIT-LOG.md); feature history: [`docs/PHASES.md`](docs/PHASES.md).

### Added
- **Coder agent** with sandboxed file/shell tools, a **verify-repair** loop, content-level **tool-call salvage** (runs calls weak models write as text/JSON/fences), and per-agent tick-boxes `verify` / `fewShot` / `selfHeal` (`selfLearn` reserved for Phase 3).
- **Runtime self-healing** — boots written servers on an injected `PORT` and smoke-imports modules, feeding runtime failures back into the repair loop.
- **Diagnose-and-compensate** registry — turns any recognized syntax/runtime error into a targeted "cause + fix" hint (model-agnostic).
- **Model profiles** (named routing policies) + **`chorale init`** (generate a tailored, tiered profile from your installed models + keys).
- **Benchmark suite** (ramp, bake-off, real-engineering, full-stack) with self-validated graders + MD/HTML/PDF reports; evidence-backed defaults: **Gemma-4-31B** heavy tier, **gpt-oss-120B** escalation.
- **CLI**: `agents`, `doctor`, `cost`, `sessions rm/prune`, `--help/--version`, stdin piping, `--json`.
- **Ops/hardening**: per-request timeout + retry/backoff, context-growth guard, leveled logging + per-session run transcript, secret redaction, delegation cycle guard, per-session token/cost persistence.

### Changed
- Default heavy tier Qwen2.5-7B → **Gemma-4-31B**; escalation GLM-5.2 → **gpt-oss-120B**.
- `maxVerifyRounds` 3 → 5; new `requestTimeoutMs` / `maxRetries` config defaults.

## [Unreleased — Phases 0 and 1]

### Added

- **Provider-agnostic runtime** on the Vercel AI SDK, with a per-agent model and a fallback chain (`modelOverride → agent.model → agent.fallbacks → base.fallbacks → base.model`).
- **Config-driven provider registry** — any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, HF, Fireworks, OpenRouter, DeepSeek, …) plus native Anthropic, added by config with no code.
- **Single-file `agent.md` format** — YAML frontmatter (`name`, `description`, `model`, `fallbacks`, `tools`, `skills`, `mcp`, `delegable`) + a markdown persona.
- **Tool-calling agent loop** with multi-step execution and per-step tool logging.
- **Research agent** and a combined **`web_research`** tool (Tavily-backed, with a DuckDuckGo fallback and graceful degradation).
- **Claude-compatible `SKILL.md` loader** with progressive disclosure via a `skill_view` tool; loads from `skills/` and `.claude/skills/`.
- **Session persistence & resume** (better-sqlite3): `--resume <id>`, `-c`/`--continue`, and `chorale sessions`.
- **Orchestrator agent** + a depth-guarded **`delegate`** tool for routing to specialists.
- **MCP client** (stdio + streamable HTTP) — connect external Model Context Protocol tool servers; tools are namespaced `mcp__<server>__<tool>`.
- **CLI**: `chorale [--agent <name>] [--model <provider:model>] [-c | --resume <id>] "prompt"` and `chorale sessions`.
- Current-date injection into every agent's system prompt.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the architecture and [`docs/ROADMAP.md`](docs/ROADMAP.md) for what's next.

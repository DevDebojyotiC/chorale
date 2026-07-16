# Phases — Feature & History Log

The big and small features, decisions, fixes, and findings per phase — the durable project history.
Updated at the completion of every phase, before shipping. Per-commit detail lives in [`COMMIT-LOG.md`](COMMIT-LOG.md).

> **Last updated:** Phase 4 in progress (reviewer + scribe agents landed; planner/gate framework underway; post-v0.2.0).

> **Detailed per-phase write-ups** (verbose — concepts + the decisions behind them, and *why*):
> [`PHASE-0-1.md`](PHASE-0-1.md) · [`PHASE-2.md`](PHASE-2.md) · [`PHASE-3.md`](PHASE-3.md) · [`PHASE-4.md`](PHASE-4.md).
> This file is the concise index; each `PHASE-*.md` expands its phase.

---

> **Foundation phases 0 & 1 detailed write-up:** [`PHASE-0-1.md`](PHASE-0-1.md).

## Phase 0 — Bootstrap ✅
- Repo, TypeScript, tsup build, vitest, ESLint, CI (`.github/workflows/ci.yml`).
- Framework spike & decision: **Vercel AI SDK v7** as the core (over Hermes/OpenClaw), with `@modelcontextprotocol/sdk` for MCP.

## Phase 1 — Model-agnostic runtime ✅
**Features**
- Model-agnostic runtime: any provider via `openai-compatible` (Ollama, LM Studio, vLLM, Fireworks, HF router, OpenRouter, Groq, DeepSeek…) or native `anthropic`. Config-only provider addition.
- Per-agent model + **fallback chain** (`modelOverride → agent.model → agent.fallbacks → base.fallbacks → base.model`).
- `agent.md` format (frontmatter + markdown persona). Agents: research, orchestrator, general.
- **Claude-compatible SKILL.md skills** with progressive disclosure (names/descriptions in prompt; bodies via `skill_view`).
- **MCP client** — connect any MCP tool server.
- Persistent **sessions** (SQLite, resume/continue across runs).
- **Orchestrator** that delegates to specialists; permission modes (read-only / auto-edit / full-auto).
- Offline **mock provider** for a keyless pipeline proof.

## Phase 2 — The coder, benchmarks, hardening ✅ (v0.2.0)

> **Detailed write-up:** [`PHASE-2.md`](PHASE-2.md) — the coder, salvage, the model evidence, compensation, and hardening.

### Coder agent & weak-model robustness
- **Coder agent** with sandboxed file/shell tools and a **verify-repair loop** (esbuild syntax check → feed errors back with escalating temperature).
- **Content-level tool-call salvage** — local models that don't emit native tool calls write them as text/JSON/backtick fences; the runtime parses and executes them. Backtick/template-literal aware, filename-tagged fences (```` ```solution.mjs ````), `ensureExports` rescue, no-op retry.
- **Stream filter** strips leaked tool-call markup from output.
- Per-provider `extraBody` (e.g. disable Ollama thinking).

### Model routing & setup
- **Model profiles**: named routing policies (`default/tiers/agents/fallbacks`); precedence `--model > profile.agents > profile.tiers > profile.default > agent.md > base`.
- **`chorale init`**: detect installed Ollama models + keys and generate a tailored, tiered profile from your *actual* models; suggests `ollama pull` for gaps.
- `docs/models-and-hardware.md`: measured local-model + VRAM guidance.

### Benchmarks & the model decision (the evidence)
- Harnesses: open-ended ramp, head-to-head bake-off, real-engineering projects, all execution-graded with partial credit and self-validated graders.
- **L1–L10 ramp across 11 models** → 7 hit 10/10; correctness saturates, so cost/speed decide. Reports in MD/HTML/PDF (`docs/model-evaluation-report.*`).
- Normalized per-token costs; GLM/Kimi totals decontaminated of prior-session usage.
- **Decisions (evidence-backed):** default heavy tier = **Gemma-4-31B** (9/10, ≈$0, fast); escalation = **gpt-oss-120B** (cheapest 10/10, ~$0.013). Premium models (GLM-5.2, Kimi-K2.6, DeepSeek-V4-Pro, MiniMax-M3) earned no advantage at this scale.
- **Real-engineering benchmark** (multi-file, tool-driven): the difficulty **crossover** — value wins on routine work (Gemma perfect), reliability wins on hard/full-stack work (gpt-oss 100% across trials; Gemma's full-stack was flaky).

### Learning, self-healing & compensation (bring the best out of any model)
- Per-agent **tick-box toggles** (default-on for coder): `fewShot` (inject `coder.examples.md` worked patterns), `selfHeal` (runtime smoke-test: boot written servers on an injected PORT, smoke-import modules, repair failures), `selfLearn` (shipped in Phase 3 — see below).
- **Diagnosed & fixed Gemma's full-stack weakness (70% → 100%)**: root cause = large HTML in a JS template literal → nested backtick. Fixed *from our end* by (a) steering to file-based HTML, (b) **targeted repair diagnostics**, (c) a bigger repair budget — none model-specific.
- **Generalized diagnose-and-compensate**: an extensible registry (`diagnose.ts`) that turns any recognized syntax/runtime error into a "cause + fix" hint, model-agnostic.

### Hardening (Tiers 1–3)
- **Network resilience**: per-request timeout + retry/backoff on 429/5xx/transient (timeouts fall back, not retried).
- **Runtime tests** via a mock model (fallback chain) + unit tests for resilience helpers.
- **Context-growth guard**, **cross-platform process cleanup** (smoke), **research-path resilience** (web fetch retry + clear degradation).
- **Leveled logging + per-session run transcript**, **secret redaction**, **delegation cycle guard**, **per-session token/cost + `chorale cost`**.

### CLI & docs (ship readiness)
- CLI: `--help/--version`, `chorale agents`, `chorale doctor` (provider ping), stdin piping, `--json`, `sessions rm/prune`. v0.2.0.
- Documentation suite: this file, `COMMIT-LOG.md`, `ARCHITECTURE.md`, `PROJECT-STATE.md`; refreshed README.

**Test count:** 93 · **Provider health:** ollama/fireworks/hf reachable.

## Phase 3 — Self-learning, TUI, tooling ✅

> **Detailed write-up:** [`PHASE-3.md`](PHASE-3.md) — self-learning, the UI-agnostic core + TUI, the npm migration, and the scope pivot.

**Done**
- **Task 1 — `selfLearn`** ✅: the coder learns fixes from its own successful diagnosed repairs (per-agent `data/lessons.sqlite`) and injects the top proven lessons proactively next run; `chorale lessons` to inspect; `CHORALE_NO_LEARN=1` for reproducible eval. See [`self-learning.md`](self-learning.md).
- **Task 2 — Ink TUI** ✅: `chorale tui` — interactive streaming chat REPL; runtime gained `onToken`/`onEvent` renderer hooks. *(The React/Ink TSX is excluded from `npm run typecheck` — the native TS7 compiler crashes on React's type tree on Windows — but is type-transpiled by `npm run build`.)*
- **Tooling — pnpm → npm migration** ✅: removed pnpm lockfile/`packageManager`, pinned deps, `esbuild` override → `npm audit` reports 0 vulnerabilities; CI on `npm ci`; all docs/comments updated.
- **Fix — session ordering determinism** ✅: `latestSession`/`listSessions`/`pruneSessions` tie-broke arbitrarily on same-millisecond `updated_at`; added a monotonic `rowid` secondary sort (resolved a CI-only flake).

**Scope change:** "more agents" is promoted out of Phase 3 into a dedicated **Phase 4 — Core Agents** (one agent per task, each with its own benchmark). The GUI becomes **Phase 5**, after the roster stabilizes. See [`ROADMAP.md`](ROADMAP.md).

## Phase 4 — Core Agents 🔜 (in progress)
The capability phase: grow the agent roster one agent per task, each shipped with an execution-graded benchmark. Order (by leverage): **1** Reviewer/Verifier · **2** Files/Docs · **3** Planner/Architect · **4** Test-writer · **5** Productivity (email/calendar/notes via MCP) — closing with a larger real-world codebase benchmark. Full rationale in [`ROADMAP.md`](ROADMAP.md).

> **Detailed, living write-up:** [`PHASE-4.md`](PHASE-4.md) — verbose documentation of every Phase-4 task, the concepts, and the decisions (and why we made them). Kept current through the phase; finalized at merge.

- **Task 1 — Reviewer** ✅: `reviewer` agent — read-only inspection (`read`/`ls`/`glob`/`grep`) + optional `bash` verification, no write tools (it flags; the coder fixes), delegable. Emits severity-tagged findings (`BLOCKER`/`MAJOR`/`MINOR`/`NIT`) with `file:line` + fix + a `VERDICT`. Benchmarked on planted-defect fixtures (`eval/reviewer-*.ts`): **recall 5/5 defects · precision 1/1 clean**, stable over 3 runs on the ≈$0 default model. A **calibration fix** (persona rule + a `fewShot` exemplar on a *held-out* function) cured a false MAJOR on correct code — precision 0/1 → 1/1 with recall unchanged, by generalization not test-tuning.
  - **Difficulty ramp** (`eval/reviewer-ramp.ts`, `REVIEWER-RAMP.md`): 10 levels of increasing *subtlety* (default-sort gotcha → prototype pollution), benchmarked on gemma-4-31B + gpt-oss-120B. Baseline exposed **complementary security blind spots** — gemma missed prototype pollution, gpt-oss missed ReDoS (both consistent). A general **security vulnerability-class checklist** added to the persona lifted **gemma to a stable 10/10** (perfect ×3, ~8s, ≈$0); gpt-oss knows the same classes but is 13–18× slower and less consistent. Same story as the coder: compensation lets the cheap fast model win.
  - **Full suites + the four mechanisms** (`eval/reviewer-suite*.ts`, `REVIEWER-SUITES.md`): precision (9 tricky-but-correct), multi-defect (find-all), polyglot (Python), and an expert security tier (timing attack, unverified JWT, SSRF). Hardened with **(1)** per-model compensation (security checklist incl. broken-verification/timing + a ReDoS safe-vs-dangerous criterion that fixed a false alarm without losing recall + a calibration rule), **(2)** few-shot (3 held-out exemplars; the third killed a shared adversarial-telemetry false positive), **(3)** self-heal via a **self-critique second pass** (`selfCritique` flag) — a guarded recall safety net (recovered gpt-oss 2→3, never drops a security finding; neutral precision), **(4)** self-learn (inject proven lessons; capture a security class the critique surfaces that the draft missed). Scorecard (gemma, single-pass): ramp 10/10 · precision 9/9 · multi 8/8 · polyglot 3/3 · expert 3/3.
  - **Production review modes**: **diff review** (judge a unified diff; `chorale review [--staged] [paths…]` on your git diff or files — gemma 3/3 regressions + correct-change APPROVE); **multi-file cross-contract** review (reads files via its tools, reasons across them — both models 3/3 recall · 1/1 precision); and a **coder review gate** (`reviewGate`, on for the coder) — after code verifies clean the reviewer gives a semantic second opinion, BLOCKER/MAJOR looping back for a fix. Live demo: coder wrote SQL injection → gate caught it → next round caught a missing `await` → clean parameterized+awaited code in 2 rounds. 112 tests.

### Task 2 — Scribe (files/docs) ✅
`scribe` agent — generates/edits/summarizes/organizes a project's documents, grounded strictly in the real files. Tools read/ls/glob/grep/write/edit/multi_edit/**move**/bash; delegable; code-loops off, doc tick-boxes on.
- **Applied file ops**: a reference-safe `move` fs tool — renames/moves within the sandbox and returns the files referencing the old path so links get updated (never deletes). Live smoke: renamed a file and rewrote the link that pointed at it.
- **`groundCheck` (anti-hallucination)** — after writing docs, verify every path they reference exists; loop back to fix invented ones (`src/core/ground.ts`). The doc analog of the coder's verify.
- **Full capability coverage** (`eval/scribe-*.ts`, `SCRIBE-RESULTS.md`): **every capability in the spec is benchmark-verified — 22 checks, all green on gemma.** Suites: groundedness, staleness, edit-safety, `gen` (API/CHANGELOG/docstrings/architecture/scaffolding/inventory/sync-apply/TOC/formatting/consistency/synthesis), `text` (summary/extraction/table/tone/Q&A/example-validation), `reorg` (reorganize/naming). Graders self-validated with no model calls.
- **Verification layer delivered in full**: `groundCheck` extended from paths → **paths + symbols + npm scripts** (a backticked `frobnicate()` or `npm run deploy` that doesn't exist is flagged); a new **meaning-preservation** pass (edit tools snapshot originals; a dropped number/token/url is flagged) that's **intent-aware + one-shot** so it protects proofreading without fighting an intended version bump. gpt-oss (escalation) is flappier at *creating* new files.
- **Multi-format document I/O** (`src/tools/documents.ts`): tools `read_doc` / `write_doc` / `write_sheet` / `convert` let the scribe **read, create, and convert real formats** — PDF, DOCX, XLSX, PPTX, HTML, CSV/TSV, JSON, and **images via OCR** — with the model authoring Markdown/rows and deterministic tools doing the binary I/O. PDF renders via headless Chrome/Edge (fidelity) with a pdfkit fallback; images OCR via tesseract.js (model-agnostic). `groundCheck` skips binary docs (verified by round-trip). Round-trip benchmark (`eval/scribe-formats.ts`): **gemma 11/11** (write 4/4 · read 4/4 · convert 3/3); gpt-oss 9/11. Libraries add 0 audit vulnerabilities (uuid pinned via overrides). HTML→PDF/DOCX render *faithfully* (real HTML, not flattened text).
- **Presentation design** (3 tiers, `src/tools/doc-themes.ts` + `eval/scribe-design*.ts`): **(1)** professional `theme` (report/docs/minimal) — gradient cover, design tokens, styled tables, callouts, print + dark; **(2)** `charts: true` turns numeric tables into grounded CSS bar charts; **(3)** a **bespoke design mode** where the model authors custom HTML with an automatic **fidelity check** (`checkDesignFidelity`) that forbids inventing data. Design-richness score: scribe `report+charts` **8/8**, exceeding the reference Claude report (6/8, which lacks print+dark); design-mode live: gemma 7/8 · gpt-oss 6/8, both 0 fabricated numbers. 139 tests.
- **Two fixes the benchmark forced**: a "use your tools / the project is the CWD" persona rule + an explicit staleness-audit procedure (0/3 → 3/3); and making the shared **self-critique prompt agent-agnostic** — it was in the reviewer's voice and derailed the scribe; the rewrite fixed the scribe *and* kept the reviewer un-regressed. 119 tests.

## Phase 5 — GUI (planned)
A richer desktop/web UI over the same UI-agnostic core (on the `onToken`/`onEvent` hooks), once the Phase-4 roster and APIs are stable.

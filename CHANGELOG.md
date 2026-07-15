# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Phase 3 (shipped) + Phase 4 (in progress, branch `phase-4`)

### Added
- **Self-learning (`selfLearn`)** — the coder records fixes from its own successful diagnosed repairs (`data/lessons.sqlite`, per agent) and injects the top proven lessons proactively on future runs. `chorale lessons [agent]` to inspect; `CHORALE_NO_LEARN=1` disables it for reproducible benchmarks. Every `diagnose` rule now carries a stable category key.
- **Ink TUI (`chorale tui`)** — interactive streaming chat REPL; `runAgent` gained `onToken`/`onEvent` renderer hooks. *(The React/Ink TSX is excluded from `npm run typecheck` due to a native-TS7 compiler crash on React types; it is type-transpiled by `npm run build`.)*
- **Reviewer agent** (Phase 4, Task 1) — read-only code review that emits severity-tagged findings (`BLOCKER`/`MAJOR`/`MINOR`/`NIT`) with `file:line` + fix + a `VERDICT`; inspection tools only (never mutates), delegable, optional `bash` verification. Planted-defect benchmark (`eval/reviewer-*.ts`): recall 5/5 · precision 1/1 on the ≈$0 default model, with a calibration fix (persona rule + few-shot exemplar) that cured false MAJORs on correct code.

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

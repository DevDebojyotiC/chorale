# Phases — Feature & History Log

The big and small features, decisions, fixes, and findings per phase — the durable project history.
Updated at the completion of every phase, before shipping. Per-commit detail lives in [`COMMIT-LOG.md`](COMMIT-LOG.md).

> **Last updated:** end of Phase 2 (v0.2.0).

---

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
- Per-agent **tick-box toggles** (default-on for coder): `fewShot` (inject `coder.examples.md` worked patterns), `selfHeal` (runtime smoke-test: boot written servers on an injected PORT, smoke-import modules, repair failures), `selfLearn` (**parked for Phase 3**).
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

## Phase 3 — Planned (not started)
- **`selfLearn`**: reflect on failures → lessons store → retrieve self-derived exemplars (feeds `fewShot` and the diagnose registry).
- Ink/TUI renderer; more agents (files/docs specialist, reviewer/verifier); larger real-world codebase benchmarks; UI over the same core.

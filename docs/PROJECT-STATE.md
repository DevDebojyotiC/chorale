# Project State

A snapshot of what exists and works right now. Refreshed at the completion of every phase, before shipping.

> **Version:** 0.2.0 · **Phase:** 2 complete · **Tests:** 93 passing · **Last updated:** end of Phase 2.

## Status at a glance
- **Runtime:** model-agnostic, production coder pipeline (salvage + verify + self-heal + diagnose-and-compensate), fallback chain with per-request timeout + retry/backoff.
- **Agents:** `coder` (verify/fewShot/selfHeal on), `research`, `orchestrator`, `general`. (5 `agent.md` files incl. examples.)
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
- **TUI shipped** (`chorale tui` — Ink streaming chat REPL); the React/Ink TSX is excluded from `pnpm typecheck` (native TS7 crashes on React types) but is type-transpiled by `pnpm build`. No files/docs or reviewer agent yet.
- Research falls back to brittle DuckDuckGo scraping without a Tavily key (degrades gracefully, but Tavily recommended).

## Quality gates
- `pnpm typecheck` (tsc, strict) · `pnpm test` (vitest, 93) · CI on push (`.github/workflows/ci.yml`).
- Graders self-validated against known-good/bad reference solutions before any benchmark run.

## Next (Phase 3)
Self-learning (`selfLearn`: reflect → lessons store → self-derived exemplars), Ink/TUI renderer, more agents, larger real-world benchmarks, UI over the same core. See [`ROADMAP.md`](ROADMAP.md).

# Commit Directory

A per-commit record of what changed, for history maintenance. Each Phase-2 task is one
annotated tag (`phase-2-task-N-*`) with `DevDebojyotiC` as sole author. Updated before shipping each phase.

> **Last updated:** end of Phase 2 (v0.2.0).

## Phase 0–1 — foundation (squashed)

| Commit | Summary |
|--------|---------|
| `db9a9ff` | **Initial commit** — model-agnostic runtime (Vercel AI SDK v7 + MCP), per-agent model + fallback chain, tool-calling agents (research, orchestrator, general), Claude-compatible SKILL.md skills (progressive disclosure), persistent SQLite sessions, MCP client, permission modes, offline mock provider. |

## Phase 2 — the coder, benchmarks, hardening (30 tasks)

| # | Commit | Tag | Summary |
|--:|--------|-----|---------|
| 1 | `3519031` | `…task-1-tool-call-repair` | Stream filter: strip leaked tool-call markup (`<tool_call>` etc.) from streamed output. |
| 2 | `ab62b79` | `…task-2-coder-agent` | Coder agent + sandboxed file/shell tools (read/write/edit/multi_edit/ls/glob/grep/bash) + permission modes. |
| 3 | `896ae27` | `…task-3-robust-coder` | Verify-repair loop (esbuild syntax check → feed errors back) + tool-arg repair. |
| 4 | `7c5d9c0` | `…task-4-weak-model-robustness` | No-op retry (empty write args) + tool-call repair for weak models. |
| 5 | `5bc3970` | `…task-5-coder-benchmark` | Cross-model coder benchmark harness. |
| 6 | `f5cf8fe` | `…task-6-difficulty-ladder` | Coder difficulty-ladder benchmark. |
| 7 | `5f8b1ed` | `…task-7-tool-call-salvage` | Content-level tool-call salvage — execute calls local models write as text/JSON/fences. |
| 8 | `9bf950f` | `…task-8-thinking-control` | Per-provider `extraBody` (e.g. `{think:false}`) + salvage path fix. |
| 9 | `2aab3f6` | `…task-9-model-profiles` | Model profiles — unified multi-mode routing (`default/tiers/agents/fallbacks`). |
| 10 | `dfda975` | `…task-10-init-wizard` | `chorale init` — detect models + keys, recommend a profile. |
| 11 | `a325ccd` | `…task-11-hardware-guide` | `docs/models-and-hardware.md` — local model + VRAM guidance (measured). |
| 12 | `e6f573d` | `…task-12-tiered-init` | Tiered init — generate a tailored profile from *installed* models. |
| 13 | `b95f77a` | `…task-13-coder-robustness` | Salvage hardening (backtick/template-literal aware, filename fences, `ensureExports`), repair-temperature escalation, open-ended ramp harness. |
| 14 | `91eeba2` | `…task-14-bakeoff` | Head-to-head bake-off harness + cumulative token accounting across attempts. |
| 15 | `a125e6e` | `…task-15-gemma-heavy` | **Default heavy tier → gemma-4-31B** (beat Qwen2.5-7B 6/6 vs 3/6). |
| 16 | `eac9f04` | `…task-16-ramp-leaderboard` | Full L1–L10 ramp leaderboard across 10 models. |
| 17 | `9ece833` | `…task-17-minimax-m3` | Add MiniMax-M3 (10/10 but 6× slower than M2.7). |
| 18 | `053125e` | `…task-18-ramp-costs` | Add real Fireworks $ cost to the leaderboard. |
| 19 | `fcc4ccf` | `…task-19-normalized-costs` | Normalized per-token costs; decontaminate GLM/Kimi totals. |
| 20 | `063c286` | `…task-20-gptoss-escalation` | **Escalation GLM-5.2 → gpt-oss-120B** (cheapest 10/10 ~$0.013). |
| 21 | `008fbb6` | `…task-21-eval-report` | Model evaluation report (MD + styled HTML + PDF). |
| 22 | `de7233e` | `…task-22-real-engineering` | Real-engineering benchmark (KV store, debug, async pool, CLI) — Gemma 26/26. |
| 23 | `f7c2a20` | `…task-23-engineering-benchmark` | Advanced tier (framework, store, **full-stack app**) + report; the difficulty crossover. |
| 24 | `ceb431e` | `…task-24-operational-rule` | Operational-correctness prompt rule + before/after experiment (70→80%, within noise). |
| 25 | `b58042a` | `…task-25-fewshot-selfheal` | Few-shot + self-healing tick-boxes (measured); `selfLearn` parked for Phase 3. |
| 26 | `6fd863c` | `…task-26-gemma-compensation` | **Compensate for Gemma's full-stack weakness — 70% → 100%** (file-based HTML steer + targeted diagnostics + budget). |
| 27 | `887e3fa` | `…task-27-diagnose-registry` | Generalize diagnose-and-compensate into an extensible registry (any error, any model). |
| 28 | `6d49959` | `…task-28-hardening` | Hardening: per-request timeout + retry/backoff, runtime tests (mock model), context guard, cross-platform smoke kill, research resilience. |
| 29 | `4ffaa26` | `…task-29-tier3-polish` | Leveled logging + run transcript, secret redaction, delegation-cycle guard, per-session cost + `chorale cost`. |
| 30 | `50cef38` | `…task-30-cli-qol` | CLI ergonomics (`--help/--version`, `agents`, stdin, `--json`), `chorale doctor`, `sessions rm/prune`; v0.2.0. |

*(Task 31 — the doc suite — added this file plus PHASES.md, ARCHITECTURE.md, PROJECT-STATE.md and the README refresh. Task 32 scrubbed the "personal" framing from the two reports.)*

## Phase 3 — in progress (branch `phase-3`)

| # | Tag | Summary |
|--:|-----|---------|
| 1 | `phase-3-task-1-self-learning` | Self-learning: record fixes from successful diagnosed repairs (`lessons.ts` / `data/lessons.sqlite`) and inject proven lessons proactively; `chorale lessons`; `CHORALE_NO_LEARN` for eval. Diagnose rules get category keys. |
| 2 | `phase-3-task-2-ink-tui` | Ink TUI `chorale tui` (streaming chat REPL); runtime `onToken`/`onEvent` hooks; lazy-loaded; TSX excluded from TS7 typecheck (esbuild-built). |
| — | *(no tag)* | Docs: README quickstart shows how to expose the `chorale` command (`npm run build && npm link`). |

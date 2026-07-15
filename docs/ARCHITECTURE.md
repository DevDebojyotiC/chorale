# Architecture

How Chorale is put together. Updated at the completion of every phase.

> **Last updated:** Phase 3 in progress (post-v0.2.0). Current-state snapshot: [`PROJECT-STATE.md`](PROJECT-STATE.md).

## Overview

Chorale is a model-agnostic, CLI-first multi-agent system built on the **Vercel AI SDK v7** and
**MCP**. Everything is config- and file-driven: providers are config, agents are `agent.md` files,
skills are `SKILL.md` files. The core is a single orchestration loop (`runAgent`) that makes even
weak local models usable through salvage, verification, self-healing, and diagnose-and-compensate.

```
CLI (src/index.ts)
  → loadConfig ─ buildRegistry ─ resolveModelPlan ─ SessionStore
  → runAgent ──────────────────────────────────────────────┐
        assemble: tools + skills + MCP + few-shot + system  │
        attempt() over the fallback chain (streamText)      │  ← timeout + retry/backoff
        salvage text tool-calls ─ verify ─ self-heal        │  ← repair loop (diagnose-and-compensate)
        cumulative usage                                    │
  → persist message + usage ─ transcript ─ done ────────────┘
```

## Directory map (`src/`)

| Area | Files | Responsibility |
|------|-------|----------------|
| **Entry** | `index.ts` | CLI: arg parsing, subcommands (`init/agents/doctor/sessions/profiles/cost`), stdin/`--json`, run a turn. |
| **Config** | `core/config.ts` | Zod-validated config (providers, profiles, agents, defaults, permissions). |
| **Model routing** | `core/model-registry.ts`, `core/model-policy.ts` | Build the AI-SDK provider registry; resolve `agent → model` via profile precedence + compose the fallback chain. |
| **Orchestration** | `core/runtime.ts` | `runAgent`: the fallback/retry loop, salvage, verify-repair, self-heal, cumulative usage, few-shot injection, delegation wiring. |
| **Robustness** | `core/tool-call-salvage.ts`, `core/verify.ts`, `core/smoke.ts`, `core/diagnose.ts`, `core/stream-filter.ts` | Parse text tool-calls; esbuild syntax verify; runtime smoke-test; error→fix diagnosis; strip tool markup. |
| **Learning** | `core/lessons.ts` (+ `core/diagnose.ts` keys) | Per-agent self-learning store: record fixes that worked, inject proven lessons proactively. |
| **Setup/ops** | `core/init.ts`, `core/doctor.ts`, `core/costs.ts`, `core/log.ts`, `core/redact.ts` | Init wizard; provider health check; cost rates; leveled logging + transcript; secret redaction. |
| **State** | `core/session.ts` | SQLite sessions, messages, usage; `chorale cost` aggregation; housekeeping. |
| **TUI** | `tui/app.tsx` (Ink + React) | Interactive streaming chat REPL (`chorale tui`); subscribes to the runtime's `onToken`/`onEvent`. Lazy-loaded; excluded from `npm run typecheck` (native TS7 crashes on React types), built by esbuild. |
| **Agents** | `agents/loader.ts` | Parse `agent.md` frontmatter (model, fallbacks, tools, skills, mcp, verify, fewShot, selfHeal, selfLearn, tier). |
| **Tools** | `tools/registry.ts`, `tools/fs.ts`, `tools/shell.ts`, `tools/web.ts`, `tools/skill.ts`, `tools/delegate.ts`, `tools/permissions.ts` | Built-in tool set; permission gating + catastrophic-command denylist; delegation with depth + cycle guards. |
| **Skills / MCP** | `skills/loader.ts`, `mcp/client.ts` | Discover/select Claude-compatible skills; connect MCP servers. |

## The `runAgent` loop (the crown jewel)

1. **Resolve** the model chain (`resolveModelPlan`) and assemble tools (built-ins + MCP + `skill_view` + `delegate`), the system prompt (persona + skills + few-shot examples), and messages.
2. **`attempt()`** streams from the first model in the chain. Each request has an **`AbortSignal` timeout**; fast transient errors (429/5xx/conn-reset) **retry with backoff** on the same model; timeouts and hard errors **fall back** to the next model. Output is stripped of tool markup and routed to `opts.onToken` when set (else stdout); tool/verify/fallback activity is emitted to `opts.onEvent` (the TUI subscribes to both); usage accumulates across every attempt.
3. **Completion loop** (bounded by `maxVerifyRounds`), each round with escalating temperature:
   - **Salvage** — if the model made no native tool call, parse and execute tool calls it wrote as text.
   - **Verify** (if `agent.verify`) — esbuild syntax-check written files; on failure feed back `verifyFeedback` + a **targeted diagnosis** (`diagnose`).
   - **Self-heal** (if `agent.selfHeal`, syntax clean) — actually *run* the code (boot servers on an injected PORT, smoke-import modules); feed runtime failures back.
   - **Self-learn** (if `agent.selfLearn`) — when a diagnosed repair succeeds, record the fix as a lesson; the agent's top proven lessons were injected into the system prompt up front.
   - No-op retry if writes were attempted but nothing landed.
4. **Context guard** caps message history so long repair chains can't overflow the window.

## Key design choices
- **Model-agnostic by construction** — `openai-compatible` is the universal provider; adding a model is config, not code.
- **Compensate, don't escalate** — a diagnosed model weakness is engineered around (steer to a reliable strategy + failure-specific repair feedback) before falling back to a stronger model.
- **Ground truth over trust** — self-heal runs the code rather than trusting the model to follow instructions.
- **Everything is a file** — agents, skills, config, examples; the diagnose registry and few-shot examples are the hooks a future `selfLearn` pass extends.

## Data & side effects
- `data/chorale.sqlite` — sessions, messages, usage (WAL). `data/logs/<session>.log` — run transcripts. Both gitignored.
- All logs/transcripts are **secret-redacted**. Provider keys come from `${ENV}` in config, resolved at load.

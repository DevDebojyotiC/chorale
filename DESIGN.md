# Chorale — Design Document (v2)

> A lean, fully-owned, **model-agnostic** multi-agent system in TypeScript.
> CLI-first. Runs any LLM (local via Ollama/LM Studio/vLLM, or serverless via any OpenAI-compatible /
> Anthropic / HF / Fireworks endpoint) behind one interface. Claude-compatible skills. MCP-native.
> Goal: a true open-source, locally-runnable replacement for Claude Desktop.

**Status:** Draft for approval · **Owner:** Debojyoti · **Date:** 2026-07-14
**Supersedes:** v1 (which assumed the Claude Agent SDK — dropped; see §3).

---

## 1. Vision & Goals

Build a program you own that behaves like a coordinated *team* of specialist agents, driven by **any
LLM you plug in** — a local Llama/DeepSeek/Gemma over Ollama today, an Anthropic key tomorrow, a
serverless HF/Fireworks endpoint the day after — with **no code changes**. Each agent can use its own
model (falling back to the chorale's base), its own tools, and Claude-compatible skills. Anyone can
author a new agent by dropping in a single markdown file.

### The 7 goals (from you) → how the design meets them
1. **OSS models local/serverless over API/MCP** → Vercel AI SDK provider layer; every provider is config; a config-only OpenAI-compatible provider (base_url + key) is the universal catch-all.
2. **Self-learning / self-healing agents** → self-healing is ON (retry + failover + tool-call-repair + error classifier); self-learning is opt-in (experience→skill proposal loop + curator).
3. **Anyone downloads, plugs any LLM, uses it per its capabilities** → capability tiers; strong models get native tool-calling + parallel delegation, weak models get prompt-based tool-calling and simpler flows. Degrades gracefully.
4. **Per-agent model, base as fallback** → each `agent.md` declares its own `model` + `fallbacks`; unset → chorale base model.
5. **Simple, robust, documented agent format so anyone can author one** → a single-file **`agent.md`** (YAML frontmatter + markdown persona). This is the differentiator neither Hermes nor OpenClaw offers.
6. **Claude-compatible skills both ways** → native `SKILL.md` loader (name/description + progressive disclosure), Claude-Code built-in toolset (Read/Write/Edit/Bash/Grep/Glob). Skills are portable unchanged in both directions.
7. **True OSS local Claude-Desktop replacement** → no hard vendor dependency; MIT/Apache-licensable; runs fully offline against a local model.

### Success criteria (v1)
- One command starts an interactive chorale session driven by a **local Ollama model** *and*, by swapping one config value, by an **Anthropic key** — same behavior.
- "Research X → cited report" and "implement/debug this code" work end-to-end through delegated agents.
- Adding an agent = one `agent.md`. Adding a provider = a few lines of config. Dropping in a Claude `SKILL.md` = it just works.
- Sessions persist and resume across CLI invocations.

---

## 2. Non-Goals (v1)
- Multi-user / hosted SaaS (single-user, local-first).
- A GUI in v1 (architecture keeps the core UI-agnostic for a later web/desktop client).
- Unbounded autonomous self-modification (self-learning is proposal-gated and opt-in).
- Reproducing every OpenClaw channel/extension — we build lean and add connectors on demand.

---

## 3. Foundation Decision (and why the SDK was dropped)

**Chosen: our own lean TypeScript runtime on the Vercel AI SDK (`ai` package).**

- The **Claude Agent SDK was dropped** because it is Anthropic-coupled and cannot natively drive
  arbitrary local/OSS models — the opposite of goal 1/3/7.
- We evaluated forking **Hermes** and **OpenClaw** (full source review in [`eval/EVALUATION.md`](eval/EVALUATION.md)).
  Both nail model-agnosticism, MCP, and Claude-skill compat (5/5), but:
  - **Hermes** core is **Python** (against the TS choice) and monolithic (300–768 KB files) → *reference-only*.
  - **OpenClaw** is TS/MIT and excellent, but a 24k-file, very-high-churn monorepo that *explicitly refuses* chorale-style orchestration as a core concept → forking means owning a huge, fast-moving base.
- **Neither ships the two things that are the point of Chorale**: a clean single-file agent format (goal 5) and chorale orchestration as the core abstraction. Those are exactly what we own.
- Decision: **build lean, own the codebase, and port the self-contained proven pieces** both frameworks validated.

The **Vercel AI SDK** provides the model layer we don't want to hand-roll: provider abstraction across
OpenAI-compatible / Anthropic / Google / local, unified tool-calling, streaming, and an MCP client.

> **API-drift note:** pin the latest `ai` + provider packages and verify exact names against installed
> types (e.g. multi-step tool loops, provider-registry, MCP client, tool-call repair hooks have all
> changed names across AI SDK majors). Treat the *capabilities* below as required; confirm *signatures* in Phase 0.

### Patterns we port from the evaluation (both frameworks converged on these)
| Pattern | Source | Where it lands in Chorale |
|---|---|---|
| `SKILL.md` + frontmatter + progressive disclosure, vendor extras namespaced | both | `src/skills/loader.ts` |
| Declarative provider registry + **config-only custom OpenAI-compatible provider** | both | `src/core/model-registry.ts` |
| `mcp_servers` config shape (stdio: command/args/env · http/sse: url/headers/transport) | both | `src/mcp/client.ts` |
| Two-stage fallback/failover (auth rotation → model fallback, cooldown) | both | `src/core/model-registry.ts` |
| **Tool-call-repair** (parse plain-text/JSON tool calls from weak models) | OpenClaw | `src/core/tool-repair.ts` |
| SQLite + FTS5 session store with lineage + compaction | both | `src/core/session.ts` |
| Experience→skill proposal loop + curator (opt-in) | both | `src/learning/*` |
| SOUL/persona as the first system-prompt slot | Hermes | `agent.md` body |

---

## 4. High-Level Architecture

```
                 ┌───────────────────────────────┐
                 │            CLI (REPL)          │
                 │   chorale · one-shot · streaming │
                 └───────────────┬───────────────┘
                                 │  normalized events
                 ┌───────────────▼───────────────┐
                 │           Chorale Core            │
                 │  runtime (agent loop) · session │
                 │  config · events · rendering    │
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │        Orchestrator agent       │
                 │   plan → delegate → synthesize  │
                 └───┬─────────┬─────────┬────────┘
             ┌───────┘     ┌───┘         └────┐
        ┌────▼────┐   ┌────▼────┐        ┌─────▼────┐
        │ Research│   │  Coder  │  ...   │  utility │  agents (agent.md)
        └────┬────┘   └────┬────┘        └─────┬────┘
             │             │                   │
   ┌─────────▼─────────────▼───────────────────▼──────────────────────┐
   │  Model layer (Vercel AI SDK): provider registry + fallback +      │
   │  tool-call-repair  ·  Tools: built-ins + MCP + custom  ·  Skills   │
   │  (SKILL.md)  ·  Memory (files+FTS5)  ·  Sessions (SQLite)  ·  Hooks │
   └───────────────────────────────────────────────────────────────────┘
```

**Model resolution per agent:** `agent.model` → provider registry entry → on error, walk `agent.fallbacks`
→ finally the chorale **base model**. Any provider is just a `{ baseUrl, apiKey, api }` config row; local
Ollama/vLLM/LM Studio and serverless HF/Fireworks/OpenRouter/Groq/DeepSeek all use the OpenAI-compatible path.

**Capability tiers:** config tags each model `native-tools` | `prompted-tools`. The runtime picks native
tool-calling when supported, else the prompted-tool-call path with **tool-call-repair** normalizing the
model's plain-text/JSON attempts into structured calls.

---

## 5. Repository Structure

```
chorale/
├── package.json · tsconfig.json · .env.example · README.md · DESIGN.md
├── eval/                         # framework evaluation (kept as decision record)
│   └── EVALUATION.md
├── config/
│   └── chorale.config.json5        # providers, models, base/fallback, enabled agents, mcp, cost
├── agents/                       # ⭐ agent.md files — portable, discoverable, "drop one in"
│   ├── orchestrator.md
│   ├── research.md
│   └── coder.md
├── skills/                       # chorale-authored skills (SKILL.md dirs)
├── src/
│   ├── index.ts                  # CLI entrypoint (bin: chorale)
│   ├── cli/ { repl, render, commands }
│   ├── core/
│   │   ├── runtime.ts            # the agent loop over Vercel AI SDK (stream + multi-step tools)
│   │   ├── orchestrator.ts       # chorale delegation / fan-out / verify / synthesize
│   │   ├── model-registry.ts     # build provider registry from config; fallback wrapper
│   │   ├── tool-repair.ts        # weak-model tool-call normalization
│   │   ├── session.ts            # SQLite + FTS5 sessions (lineage, compaction, resume)
│   │   ├── config.ts             # load + zod-validate config & env
│   │   ├── permissions.ts        # permission modes + safety policy
│   │   └── events.ts             # normalize model/tool stream → UI events
│   ├── agents/loader.ts          # parse agent.md (frontmatter + body)
│   ├── skills/loader.ts          # parse SKILL.md, progressive disclosure, load .claude/skills too
│   ├── tools/                    # built-ins (read/write/edit/bash/grep/glob) + memory + delegate + skill_view
│   ├── mcp/client.ts             # MCP client (stdio/http/sse) from mcp_servers config
│   ├── memory/store.ts           # markdown-frontmatter memory + MEMORY.md index + recall
│   └── learning/                 # experience→skill proposals + curator (opt-in)
├── .claude/                      # OPTIONAL compat: .claude/agents + .claude/skills load unchanged
└── data/                         # gitignored: chorale.sqlite, memory/, logs/
```

**Principle:** `agents/*.md` and `skills/*/SKILL.md` are the **portable source of truth** — plain files
anyone can author, no code required. `src/` is the lean engine that loads and orchestrates them.

---

## 6. The `agent.md` Format (the differentiator, goal 5)

A single self-contained file. YAML frontmatter = declarative config; markdown body = the system prompt/persona.

```markdown
---
name: research
description: Multi-source web research producing adversarially-verified, cited reports.
model: ${base}              # or "ollama:llama3.3", "anthropic:claude-opus-4-8", "fireworks:..."
fallbacks: [ollama:qwen2.5, anthropic:claude-haiku-4-5]
tools: [web_search, web_fetch, read, write, memory_write, memory_recall, skill_view]
skills: [deep-research]     # allowlist; loaded by description, body on demand
mcp: [tavily]               # MCP servers this agent may use
permissions: { mode: default, bash: prompt }
capability: native-tools    # or prompted-tools (overrides model default)
---

You are Research, a specialist in rigorous, cited investigation.
Decompose the question → search broadly → fetch and read sources →
adversarially verify each claim → synthesize with inline citations.
Prefer primary sources. State uncertainty explicitly.
```

- **Compatible-by-design** with Claude Code subagent files (same `name`/`description`/`model`/`tools`
  frontmatter idiom), so Claude subagents port in with minimal change.
- Loader validates with zod; unknown keys are preserved (forward-compat).
- This is the format we **document and open-source** as the "Chorale agent SDK contract."

---

## 7. Agent Roster (Research + Coder are v1)

**Workload agents**
- **Research** ⭐v1 — web search/fetch, `deep-research` skill, cited reports.
- **Coder** ⭐v1 — Read/Write/Edit/Bash/Grep/Glob, `code-review`/`verify` skills, permission-gated shell.
- **Productivity** (v2) — email/calendar/notes/tasks via MCP connectors; mutating actions require confirmation.
- **Files & Docs** (v2) — pdf/docx/xlsx/pptx/dataviz skills, local file ops.

**Utility agents**
- **Orchestrator** — the router; owns delegation.
- **Token-Reducer / Compactor** — summarize + prune context; drives compaction.
- **Memory / Knowledge** — curate the file-based knowledge store.
- **Verifier / Critic** — adversarial quality gate on high-stakes outputs.
- **Design** — dataviz/artifact/diagram output.
- **Scheduler** (v3) — cron/heartbeat background runs + notifications.

---

## 8. Orchestration & Sessions
- Orchestrator is an agent whose toolset includes `delegate` (spawn a specialist into an isolated sub-session).
- **Deterministic chorale patterns live in `orchestrator.ts`** (route by description-match; fan-out → verify → synthesize; depth-bounded) rather than relying on the model to remember to delegate. This is Chorale's core IP.
- Sub-agents run isolated (goal + context only, restricted tools). Results stream back and are synthesized.
- **Sessions:** SQLite + FTS5; capture/resume/list/fork; compaction rotates to a child session preserving tool-call pairs. `chorale sessions`, `--resume`, `--continue`.

## 9. Skills (goal 6)
- Loader parses `SKILL.md` frontmatter (`name`,`description`), injects only name+description into the prompt (progressive disclosure), loads the body via a `skill_view` tool on trigger. Chorale-specific extras under a `metadata.chorale` namespace.
- Loads from `skills/`, `.claude/skills/`, and user dirs — **Claude skills run unchanged**; Chorale skills run in Claude Code (extras ignored).
- Ships a **Claude-Code-compatible built-in toolset** (Read/Write/Edit/Bash/Grep/Glob) so skills that assume those tools work.

## 10. Tools & MCP (goal 1)
- **Built-in tools:** read/write/edit/bash/grep/glob + memory + delegate + skill_view.
- **Custom tools:** typed with zod; registered in a central registry.
- **MCP client:** stdio + http/sse from `mcp_servers` config; discovered tools materialized into the agent tool list, namespaced `mcp__<server>__<tool>`, filtered per agent. (Chorale-as-MCP-server is a later nicety.)

## 11. Model Layer, Fallback & Weak Models (goals 1, 3, 4)
- **Provider registry** built at runtime from config: named providers, each `{ api: "openai-compatible"|"anthropic"|..., baseUrl, apiKey(env), models[] }`. Reference models as `provider:model`.
- **Config-only custom providers** cover Ollama / LM Studio / vLLM / HF router / Fireworks / OpenRouter / Groq / DeepSeek / any base_url — no code to add one.
- **Fallback:** on 429/5xx/auth errors, rotate credentials then walk the agent's `fallbacks`, then base model; cooldown/backoff. Ported from both frameworks' two-stage failover.
- **Tool-call-repair:** normalize plain-text/JSON tool calls from weak local models into structured calls; "unknown tool" guard. Enables goal 3's "works per the model's capabilities."

## 12. Self-Learning & Self-Healing (goal 2)
- **Self-healing (ON by default):** retry+backoff (honor Retry-After), provider failover, tool-call-repair, an error classifier taxonomy (retry / rotate / failover / compress / abort), discard no-effect interrupted tool results.
- **Self-learning (opt-in, gated):** after a successful multi-step task + idle, a background pass distills a **skill proposal** (status pending→applied, with a security scan + rollback); a **curator** archives stale skills. Never unbounded self-modification. Config: `learning.enabled: false` by default.
- **Memory:** markdown-frontmatter files + `MEMORY.md` index + FTS5 recall; memory-nudge and write-approval gates.

## 13. Permissions, Hooks & Safety
- Per-agent permission modes; hooks (PreToolUse/PostToolUse/PreCompact).
- **Hard safety rules enforced in code** (not just prompts): no sending messages, purchases, permission changes, or deletions without explicit CLI confirmation; secrets only in `.env`, never logged or written to memory/URLs.

## 14. Configuration
`config/chorale.config.json5`:
```json5
{
  base: { model: "ollama:llama3.3", fallbacks: ["anthropic:claude-haiku-4-5"] },
  providers: {
    ollama:    { api: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "ollama" },
    anthropic: { api: "anthropic", apiKey: "${ANTHROPIC_API_KEY}" },
    fireworks: { api: "openai-compatible", baseUrl: "https://api.fireworks.ai/inference/v1", apiKey: "${FIREWORKS_API_KEY}" },
    hf:        { api: "openai-compatible", baseUrl: "https://router.huggingface.co/v1", apiKey: "${HF_TOKEN}" },
  },
  agents: { enabled: ["orchestrator", "research", "coder"] },
  mcp: { servers: {} },
  learning: { enabled: false },
  cost: { sessionCapUsd: 5, warnAtUsd: 2 },
}
```

## 15. CLI (goal — CLI-first)
- `chorale` REPL (streaming, tool-event lines, active-agent indicator) + one-shot `chorale "…"`.
- Flags: `--agent`, `--resume`, `--continue`, `--model`, `--json`. Slash: `/agents /model /session /cost /memory /help`.

## 16. UI Path (later)
- Core (`src/core`, `agents`, `skills`, `tools`, `mcp`) is UI-agnostic and emits normalized events. A future local web server (SSE/WS) + React client, or Tauri shell, reuses it with **no core rewrite**.

## 17. Tech Stack
- Node 22 · TypeScript ESM · pnpm.
- `ai` (Vercel AI SDK) + provider packages (`@ai-sdk/openai`/`openai-compatible`, `@ai-sdk/anthropic`, …).
- `zod` (schemas), `gray-matter` (frontmatter), `better-sqlite3` (FTS5 sessions/memory), a CLI/render lib (TBD: plain vs `ink`), `dotenv`.
- `tsx` (dev), `tsup`/`tsc` (build), `vitest` (tests).

## 18. Roadmap
| Phase | Deliverable |
|---|---|
| **0 — Scaffold** | Repo, config loader, provider registry, minimal runtime that streams one `agent.md` against **both** a local Ollama model and an Anthropic key. Proves model-agnosticism end-to-end. |
| **1 — Research slice** | Orchestrator + Research agent, `SKILL.md` loader + `deep-research`, MCP client, SQLite sessions, memory tools. Ask→delegate→cited report. |
| **2 — Coder** | Coder agent, built-in file/shell tools, permission policy, tool-call-repair, fallback. |
| **3 — Self-heal/learn + utility** | Error classifier + failover hardening; opt-in experience→skill loop + curator; Token-Reducer, Memory, Verifier. |
| **4 — Productivity + Files** | MCP connectors (Gmail/Calendar/Notion/filesystem); Files/Docs agent + document skills. |
| **5 — Scheduler + polish** | Cron/heartbeat autonomy + notifications; docs, "author your own agent" guide (open-source the SDK contract). |
| **6 — UI** | Local server + web client over the same core. |

## 19. Open Questions
1. **AI SDK API signatures** — verify provider-registry / MCP client / multi-step / tool-repair names against installed version in Phase 0.
2. **CLI/TUI library** — plain streaming vs `ink`. Decide before the Phase 1 renderer.
3. **MCP connectors to prioritize** — which of Gmail/Calendar/Notion/GitHub/filesystem for Phase 4 (drives OAuth work).
4. **SQLite driver** — `better-sqlite3` (stable, FTS5) vs Node 22 `node:sqlite` (experimental).
5. **Model routing heuristics** — when the orchestrator answers inline vs delegates.
6. **Windows-first** — validate Bash tool + MCP stdio + local-model endpoints on Windows early (dev machine).

## 20. Decisions Locked
- ✅ Lean, fully-owned TypeScript core on the **Vercel AI SDK**. Claude Agent SDK dropped.
- ✅ Model-agnostic via a config-driven provider registry; config-only custom OpenAI-compatible providers.
- ✅ Single-file **`agent.md`** format + **chorale orchestration** are Chorale's owned differentiators.
- ✅ Claude-compatible `SKILL.md` + built-in toolset; MCP-native.
- ✅ Self-healing ON; self-learning opt-in/gated.
- ✅ Research + Coder first. CLI-first; UI later over the same core.
- ✅ Hermes = reference; OpenClaw = reference; neither forked.

*Awaiting approval to proceed to Phase 0.*

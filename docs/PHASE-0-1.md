# Phases 0 & 1 — Foundation

> **Status:** ✅ complete · **Shipped in:** the initial commit (`db9a9ff`, 2026-07-15) · **Last updated:** 2026-07-16
>
> A descriptive record of the two foundation phases — the build/tooling bootstrap (Phase 0)
> and the model-agnostic runtime (Phase 1) — with the concepts and the decisions behind them,
> and *why* each was chosen. These phases predate the per-task commit history (they landed
> together as the first commit), so this write-up reconstructs them from the codebase and the
> project's design notes.

---

## 1. What these phases established

Chorale's goal is a **model-agnostic, CLI-first, local-first multi-agent system** — a replacement
for a closed desktop assistant that you can point at any model (a local Ollama model, a hosted
endpoint, or a frontier API) and that runs specialist agents over your own machine and files.

Phases 0 and 1 are the substrate everything else stands on. Phase 0 is the engineering bootstrap:
the repo, the build, the test harness, CI, and — most consequentially — the **framework decision**.
Phase 1 is the runtime that decision enabled: a provider-agnostic execution loop, the agent format,
skills, MCP, sessions, the orchestrator, and permission modes.

Nothing here is a "feature" a user sees directly; it's the set of load-bearing choices that made the
later phases cheap to build and hard to get wrong.

---

## 2. Phase 0 — Bootstrap ✅

### 2.1 Engineering scaffold

- **TypeScript** throughout, built with **tsup**, tested with **vitest**, linted with **ESLint**,
  and gated by **CI** (`.github/workflows/ci.yml`).
- A clean module layout separating the core runtime, the tools, the agents, and the CLI — so that
  agents are declarative data (Markdown files) and the runtime is the only place with control flow.

### 2.2 The framework decision (the one that mattered)

The pivotal Phase-0 act was a **framework spike and decision**: build the core on the
**Vercel AI SDK v7**, with the **`@modelcontextprotocol/sdk`** for MCP — chosen over heavier
agent frameworks (Hermes / OpenClaw-style stacks).

**Why the AI SDK v7.** The single most important product requirement is *model-agnosticism*. The AI
SDK exposes a uniform `streamText`/tool-calling interface across providers and — critically — an
**`openai-compatible`** provider that speaks to *any* endpoint implementing the OpenAI wire format:
Ollama, LM Studio, vLLM, Fireworks, the HuggingFace router, OpenRouter, Groq, DeepSeek, and more.
That means **adding a provider is configuration, not code** — the exact property a model-agnostic
system needs. Native `anthropic` support covers the non-OpenAI-shaped case. Heavier frameworks would
have coupled us to their own agent abstractions and made "run this on my local model" harder, not
easier.

**Why MCP.** The Model Context Protocol is the emerging open standard for tool servers. Adopting the
official SDK means any MCP server in the ecosystem becomes available to Chorale's agents without
bespoke integration — the same "capabilities are pluggable, not hard-coded" philosophy applied to
tools rather than models.

---

## 3. Phase 1 — Model-agnostic runtime ✅

Phase 1 turned the framework decision into a working runtime. Each piece below is paired with the
concept it introduces and the reason it exists.

### 3.1 The model-agnostic execution core

Any provider is reachable through `openai-compatible` (local or hosted) or native `anthropic`.
Providers are declared in config; the runtime resolves a provider + model string and runs the turn.

**Concept — provider indirection.** Agents never name a concrete SDK client; they name a
`"<provider>:<model>"` string. The runtime maps that to a configured client. This is what lets the
*same* agent run on a laptop's Ollama model in one config and a hosted 120B model in another.

### 3.2 Per-agent model + the fallback chain

Every agent can specify its own model and a list of fallbacks. Resolution follows a strict
precedence:

```
modelOverride  →  agent.model  →  agent.fallbacks  →  base.fallbacks  →  base.model
```

**Concept — graceful failover.** If the primary model errors (rate limit, 5xx, transient network),
the runtime walks down the chain until one succeeds, rather than failing the whole turn. This is the
minimal form of resilience; Phase 2 later enriched it with timeouts and backoff.

**Why a chain, not a single model.** Local models go down, hosted endpoints rate-limit, and different
agents want different tiers. A precedence chain expresses all of that declaratively: a per-run
override for experiments, an agent's preferred model, its own fallbacks, then the base defaults.

### 3.3 The `agent.md` format

An agent is a single Markdown file: **YAML frontmatter** (name, description, model, fallbacks, tools,
skills, delegability, tick-box toggles, tier) plus a **Markdown body** that is the system prompt.
Phase 1 shipped the first agents: **research**, **orchestrator**, and **general**.

**Why Markdown-as-agent.** Making an agent *data* rather than code means users can read, fork, and
write agents without touching the runtime — the same reason Claude Code uses Markdown agent/skill
files. The runtime stays the single locus of control flow; behavior lives in editable text.

### 3.4 Skills — Claude-compatible SKILL.md with progressive disclosure

Chorale reads Claude-compatible **SKILL.md** skill files. To keep the prompt lean, skills use
**progressive disclosure**: only each skill's *name and description* go into the system prompt; the
full body is loaded on demand via a `skill_view` tool when the agent decides it's relevant.

**Why progressive disclosure.** Injecting every skill body would burn context and money on every
turn. Names+descriptions let the model *choose* what to expand, so a large skill library costs almost
nothing until used — the same design as Claude's skills.

### 3.5 MCP client

Chorale can connect to any MCP tool server declared in config, and expose its tools to permitted
agents. **Why:** it makes the tool surface open-ended and standards-based — new capabilities arrive
as MCP servers, not as core patches.

### 3.6 Persistent sessions (SQLite)

Conversations persist to a local SQLite database and can be resumed or continued across CLI
invocations. **Why SQLite + local-first:** durable, dependency-light, and entirely on the user's
machine — matching the privacy and offline goals. (A later determinism fix to the recency ordering
landed in Phase 3.)

### 3.7 The orchestrator and delegation

The **orchestrator** agent routes a request: answer it directly if trivial, or **delegate** a
self-contained sub-task to a specialist (e.g. research). Delegation is one-way and one specialist at a
time, so the orchestrator stays the synthesizer of results.

**Why an orchestrator.** A multi-agent system needs a front door that decides *who* handles a
request. Keeping specialists non-delegating (leaf workers) — a rule that pays off much later in Phase
4's gate design — avoids uncontrolled agent recursion from day one.

### 3.8 Permission modes

Every run has a permission mode — **read-only**, **auto-edit**, or **full-auto** — that gates which
tools an agent may use (e.g. no write/shell tools in read-only). **Why:** a system that edits files
and runs shell commands must make its blast radius explicit and user-controlled, not implicit.

### 3.9 The offline mock provider

A keyless **mock provider** lets the whole pipeline run in CI and local dev without any API
credentials — proving the runtime end-to-end offline. **Why:** the test suite (and contributors
without keys) must be able to exercise the runtime deterministically; the mock model also became the
backbone of Phase 2's fallback-chain tests.

---

## 4. Concepts introduced here (carried through every later phase)

- **Provider indirection** — agents name a `"provider:model"` string; the runtime maps it to a client.
- **Fallback chain** — ordered model resolution with graceful failover.
- **`agent.md`** — an agent is declarative Markdown (frontmatter + persona), not code.
- **Progressive disclosure** — skills advertise names/descriptions; bodies load on demand.
- **MCP** — pluggable, standards-based tool servers.
- **Permission modes** — read-only / auto-edit / full-auto gate the tool surface.
- **Sessions** — local SQLite persistence with resume/continue.
- **Mock provider** — keyless, deterministic runtime for CI and tests.

---

## 5. Why this foundation held up

Every later phase is an *addition* to this substrate, not a rewrite of it: the coder (Phase 2) is a
new `agent.md` + tools; the reviewer and scribe (Phase 4) are new agents; the gate framework (Phase 4)
extends the same runtime loop and `agent.md` frontmatter. The two foundation choices that paid the
biggest dividends were **model-agnosticism via `openai-compatible`** (which made the entire Phase-2
model bake-off possible — you can't compare 11 models cheaply if each needs bespoke integration) and
**agents-as-data** (which made "one agent per task" in Phase 4 a matter of writing Markdown, not
extending the engine).

---

## 6. Related documents

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the high-level system architecture.
- [`PHASES.md`](PHASES.md) — the running phase index (this doc expands the Phase 0/1 entries).
- [`PHASE-2.md`](PHASE-2.md) — the coder, the model evidence, and hardening.
- [`ROADMAP.md`](ROADMAP.md) — phase ordering and rationale.

# Chorale

A lean, fully-owned, **model-agnostic** multi-agent system in TypeScript — a local,
open-source replacement for Claude Desktop. Run **any** LLM (local via Ollama/LM Studio/vLLM,
or serverless via any OpenAI-compatible / Anthropic / HF / Fireworks endpoint) behind one CLI.
Claude-compatible skills. MCP-native. CLI-first, UI later.

> **Status: Phase 1 complete.** Working today: model-agnostic runtime + per-agent fallback,
> tool-calling agents, a grounded web **Research** agent (Tavily), Claude-compatible **SKILL.md**
> skills (progressive disclosure), persistent **sessions** (resume across runs), an **orchestrator**
> that delegates to specialists, and an **MCP client** (connect any MCP tool server). Next (Phase 2):
> tool-call-repair, an `ink` CLI renderer, more agents (coder/files), and self-learning. See
> [`DESIGN.md`](DESIGN.md) for the architecture and [`eval/EVALUATION.md`](eval/EVALUATION.md)
> for the framework evaluation that shaped it.

## Quickstart

```bash
pnpm install
cp .env.example .env        # fill in keys for the providers you use (optional for local)
```

Point the base model at whatever you run. In `config/chorale.config.json5`:

```json5
base: { model: "ollama:llama3.2" }   // or "anthropic:claude-opus-4-8", "fireworks:...", etc.
```

Then:

```bash
pnpm dev "Explain what a chorale of agents is."          # interactive dev run (tsx)
pnpm build && node dist/index.js "same, via the built binary"
chorale --agent general --model anthropic:claude-haiku-4-5 "force a specific model"
```

## Offline smoke test (no keys, no local model)

```bash
node scripts/mock-openai-server.mjs &                  # tiny OpenAI-compatible mock
chorale --model mock:test-model "prove the pipeline works"
pnpm exec tsx scripts/proof.ts                         # full pipeline + fallback-chain proof
```

## Add a provider — config only, no code

```json5
providers: {
  myproxy: { api: "openai-compatible", baseUrl: "https://host/v1", apiKey: "${MY_TOKEN}" },
}
```
`openai-compatible` covers Ollama, LM Studio, vLLM, Fireworks, HF router, OpenRouter, Groq,
DeepSeek, and any other OpenAI-compatible endpoint. `anthropic` is a first-class native provider.

## Add an agent — one file

Drop `agents/<name>.md`:

```markdown
---
name: research
description: Multi-source web research producing cited reports.
model: ${base}                 # inherit the chorale base, or pin e.g. "anthropic:claude-opus-4-8"
fallbacks: [ollama:qwen2.5]
tools: []
---
You are Research, a specialist in rigorous, cited investigation.
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev "<prompt>"` | Run the CLI via tsx (no build) |
| `pnpm build` | Bundle to `dist/` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Run the vitest suite |

## Roadmap
Phase 0 ✅ · Phase 1 (Research agent, skills, MCP, sessions) → see [`DESIGN.md` §18](DESIGN.md).

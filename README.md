# Chorale

A lean, fully-owned, **model-agnostic** multi-agent system in TypeScript — a local, open-source
replacement for Claude Desktop. Run **any** LLM (local via Ollama/LM Studio/vLLM, or serverless via
any OpenAI-compatible / Anthropic / HF / Fireworks endpoint) behind one CLI. Claude-compatible
skills. MCP-native. CLI-first, UI later.

> **Status: Phase 2 complete (v0.2.0).** A production **coder** agent that *compensates for each
> model's weaknesses* — content-level tool-call salvage, verify-repair, runtime **self-healing**,
> few-shot steering, and a generalized **diagnose-and-compensate** loop. Model **profiles** +
> `chorale init`. Evidence-backed model routing (**Gemma-4-31B** default → **gpt-oss-120B** escalation)
> from a full L1–L10 + real-engineering benchmark suite. Hardened (timeouts/retries, leveled logging +
> transcripts, secret redaction, delegation guards, cost tracking). See
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/PROJECT-STATE.md`](docs/PROJECT-STATE.md).

## Quickstart

```bash
pnpm install
cp .env.example .env                 # keys for the providers you use (optional for local-only)
pnpm build && npm link               # expose the `chorale` command on your PATH
#   ↳ no link? just use `pnpm dev "<prompt>"` (runs via tsx, no build) for everything below.
chorale init                         # detect your models + keys, generate a tailored profile
chorale doctor                       # confirm your providers are reachable
chorale "Explain what a chorale of agents is."
chorale tui                          # or drop into the interactive terminal UI
```

> The linked `chorale` runs the built `dist/`, so re-run `pnpm build` after code changes
> (or use `pnpm dev …` during development). Undo the link with `npm unlink -g chorale`.

Point the base model at whatever you run — `config/chorale.config.json5`:

```json5
base: { model: "ollama:qwen2.5-coder:3b" }   // or "anthropic:claude-opus-4-8", "fireworks:...", "hf:...", etc.
```

## CLI

```bash
chorale "prompt"                       # run a turn (prompt may also be piped: echo "fix X" | chorale)
chorale tui                            # interactive streaming chat REPL (Ink terminal UI)
chorale --agent coder "build a todo CLI that persists to JSON"
chorale -m hf:google/gemma-4-31B-it --json "..."   # force a model; structured output
chorale agents | profiles [name] | sessions [rm <id> | prune] | cost [session] | lessons [agent] | doctor
```

`--help` for the full reference. Flags: `-a/--agent`, `-m/--model`, `-p/--profile`, `-r/--resume`,
`-c/--continue`, `--mode|--yolo|--read-only`, `--json`, `-v/--verbose`, `-q/--quiet`.

## Recommended models

From the [evaluation](docs/model-evaluation-report.md) + [engineering benchmark](docs/engineering-benchmark-report.md):
**default heavy tier = `hf:google/gemma-4-31B-it`** (fast, ≈$0, reliable through the coder's compensation
layer), **escalation = `fireworks:…/gpt-oss-120b`** (cheapest perfect scorer for complex/full-stack work).
Constrained VRAM: `ollama:qwen2.5-coder:3b`. See [`docs/models-and-hardware.md`](docs/models-and-hardware.md).

## Add a provider — config only, no code

```json5
providers: {
  myproxy: { api: "openai-compatible", baseUrl: "https://host/v1", apiKey: "${MY_TOKEN}" },
}
```
`openai-compatible` covers Ollama, LM Studio, vLLM, Fireworks, HF router, OpenRouter, Groq, DeepSeek,
and any other OpenAI-compatible endpoint. `anthropic` is a first-class native provider.

## Add an agent — one file

Drop `agents/<name>.md`:

```markdown
---
name: coder
description: Writes, edits, debugs, and runs code in the project directory.
model: hf:google/gemma-4-31B-it
fallbacks: [fireworks:accounts/fireworks/models/gpt-oss-120b, ollama:qwen3:4b]
tier: code
tools: [read, ls, glob, grep, write, edit, multi_edit, bash]
verify: true       # syntax verify-repair on written files
fewShot: true      # inject <name>.examples.md worked patterns
selfHeal: true     # run written code (boot servers / import modules) and repair failures
---
You are Chorale-Coder, a meticulous software engineer…
```

Agents can also `delegate` to specialists, load Claude-compatible **skills** (`skills/<name>/SKILL.md`),
and use **MCP** tool servers — all declared in frontmatter.

## Offline smoke test (no keys, no local model)

```bash
node scripts/mock-openai-server.mjs &                  # tiny OpenAI-compatible mock
chorale --model mock:test-model "prove the pipeline works"
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev "<prompt>"` | Run the CLI via tsx (no build) |
| `pnpm build` · `pnpm typecheck` · `pnpm test` | Bundle · `tsc --noEmit` · vitest (93 tests) |

## Docs
[`ARCHITECTURE`](docs/ARCHITECTURE.md) · [`PROJECT-STATE`](docs/PROJECT-STATE.md) · [`PHASES`](docs/PHASES.md) ·
[`COMMIT-LOG`](docs/COMMIT-LOG.md) · [`ROADMAP`](docs/ROADMAP.md) · [`model profiles`](docs/model-profiles.md) ·
[`models & hardware`](docs/models-and-hardware.md) · evaluation reports (MD/HTML/PDF) in [`docs/`](docs/).

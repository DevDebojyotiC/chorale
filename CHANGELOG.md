# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Initial development — Phases 0 and 1. Not yet released.

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

See [`DESIGN.md`](DESIGN.md) for the architecture and `ROADMAP` (planned) for what's next.

[Unreleased]: https://example.com/compare/HEAD

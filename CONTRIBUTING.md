# Contributing to Chorale

Thanks for your interest in **Chorale** — a model-agnostic, local-first multi-agent system in TypeScript.
This guide covers setup, the dev loop, and how to add agents, skills, providers, and tools.

## Prerequisites

- **Node.js ≥ 22**
- **pnpm ≥ 9** (`corepack enable`, or install pnpm directly)
- Optional: a local model via [Ollama](https://ollama.com), or an API key for a serverless provider (HF, Fireworks, Anthropic, …)

## Setup

```bash
git clone <repo-url>
cd chorale
pnpm install
cp .env.example .env    # add keys for the providers you use (optional for local models)
```

## Development loop

| Command | What it does |
|---|---|
| `pnpm dev "<prompt>"` | Run the CLI via `tsx` (no build) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Run the vitest suite (offline, deterministic — no live LLM calls) |
| `pnpm build` | Bundle to `dist/` with `tsup` |

`typecheck`, `test`, and `build` must all pass before a PR is merged — CI enforces this on Linux and Windows.

## Project layout

```
agents/     agent.md definitions (portable, drop-in)
skills/     SKILL.md skills (Claude-Code compatible)
config/     chorale.config.json5
src/
  core/     runtime, model-registry, session, config
  tools/    built-in tools (web, skill_view, delegate) + MCP wrapping
  skills/   SKILL.md loader
  mcp/      MCP client
test/       vitest suites
```

## Ways to contribute

- **Add an agent** — drop an `agent.md` into `agents/` (frontmatter: `name`, `description`, `model`, `fallbacks`, `tools`, `skills`, `mcp`, `delegable` + a markdown persona).
- **Add a skill** — a `SKILL.md` directory in `skills/` (Claude-Code / agentskills.io compatible; extras under a `metadata.chorale` namespace).
- **Add a provider** — usually **config-only** in `config/chorale.config.json5`; `openai-compatible` covers most endpoints. No code needed.
- **Add a built-in tool** — a typed tool in `src/tools/` registered in `src/tools/registry.ts`.
- **Core fixes / features** — see open issues.

## Coding conventions

- TypeScript, ESM, `strict` mode. Avoid `any`; prefer precise types.
- Match the surrounding code's style, naming, and comment density.
- Keep the core lean — prefer config and plugins over hardcoding.
- Add or update tests for behavior changes. Tests must stay offline and deterministic (no network / no live models).
- Never log or persist secrets.

## Commits & pull requests

- Keep each PR focused on one change; explain **what** and **why**.
- Ensure CI is green (`typecheck` + `test` + `build`).
- Reference any related issue.

## Security

See [SECURITY.md](SECURITY.md). Please report vulnerabilities privately rather than in a public issue.

## License

> **The project license is not yet finalized (TBD).** By contributing, you agree your contributions
> will be licensed under the project's eventual open-source license. A `LICENSE` file will be added
> once the license is chosen.

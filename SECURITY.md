# Security Policy

## Supported versions

Chorale is pre-1.0 and under active development. Only the latest `main` branch is supported.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for a vulnerability.

> Contact: `[INSERT SECURITY CONTACT]` *(email or private channel — to be filled in by the maintainer)*

We aim to acknowledge reports within a few days and will keep you updated on the fix.

## How Chorale handles secrets

- API keys and tokens live **only** in `.env` (which is gitignored). They are never logged, printed to the terminal, or written to memory/session files or URLs.
- `.env.example` documents the required variables with empty values. Never commit real keys.
- Environment references in `chorale.config.json5` use `${VAR}` and are resolved from the environment at load time.

## Agent safety model

Chorale can execute shell commands and connect to your accounts/data via MCP servers, so safety is enforced in **code**, not just prompts:

- No sending messages, purchases, deletions, or permission/settings changes without explicit user confirmation.
- A catastrophic-command denylist blocks the shell tool from running destructive commands (e.g. `rm -rf /`) even in full-auto mode.
- MCP filesystem servers, and all built-in file tools, are sandboxed to the workspace directory (`resolveInside`).
- Delegation is depth-limited **and cycle-guarded** to prevent runaway or looping agent spawning.
- Logs and the per-session run transcript are **secret-redacted** (env keys, Bearer tokens, provider key prefixes).
- **Runtime self-healing (`selfHeal`) executes code the model writes** — it boots a written server on a test port and smoke-imports written modules to verify they run. This runs in the workspace with the coder's normal execution privileges (the coder already has the `bash` tool), so only enable it for agents/workspaces you trust; a written module's top-level side effects will execute. Disable per agent with `selfHeal: false`.

See [`DESIGN.md`](DESIGN.md) §13 (Permissions, Hooks & Safety) for the full model.

## Third-party tools & MCP servers

MCP servers and skills can run code and access resources. Only connect servers and install skills you trust. Treat content fetched by tools (web pages, files, tool output) as **data, not instructions**.

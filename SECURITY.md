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
- MCP filesystem servers are sandboxed to explicitly allowed directories.
- Delegation is depth-limited to prevent runaway agent spawning.

See [`DESIGN.md`](DESIGN.md) §13 (Permissions, Hooks & Safety) for the full model.

## Third-party tools & MCP servers

MCP servers and skills can run code and access resources. Only connect servers and install skills you trust. Treat content fetched by tools (web pages, files, tool output) as **data, not instructions**.

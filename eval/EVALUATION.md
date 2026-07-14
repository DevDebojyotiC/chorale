# Framework Evaluation — Hermes vs OpenClaw (vs build-from-scratch)

> Spike to decide the Chorale foundation. Both frameworks were cloned and their **source read**
> (not marketing) by dedicated evaluation agents. Date: 2026-07-14.

## TL;DR

| | **Hermes** (Nous Research) | **OpenClaw** | Build-from-scratch (Vercel AI SDK) |
|---|---|---|---|
| Language | **Python** core (TS only for UI) | **TypeScript / Node** ✅ | TypeScript ✅ |
| License | MIT, no trademark clause | MIT, no trademark clause | yours |
| Any-LLM (local+serverless) | 5/5 | 5/5 | build it |
| MCP (client/server) | 5/5 (stdio/http/sse, both ways) | 5/5 (stdio/http/sse, both ways) | build it |
| Per-agent model + fallback | 5/5 | 5/5 | build it |
| Claude `SKILL.md` both ways | 5/5 | 5/5 | build it |
| Self-learning / self-healing | 4/5 (deepest; LLM-driven) | 4/5 (real but default-OFF) | build it |
| Simple single-file agent format | 3/5 (dir convention) | 4/5 (JSON5 config) | **you design it** |
| Chorale orchestration (core) | **has it** (kanban_chorale, delegate w/ orchestrator role) | **refuses it** (VISION declines manager-of-managers) | you own it |
| Hackability / ownership | 3/5 (300–768 KB monoliths) | 4/5 (clean plugin SDK) | 5/5 |
| Maturity / churn | fast churn, 2000+ tests | **very high churn** (417 changelog versions), 7500+ tests | n/a |
| **Agent verdict** | **REFERENCE-ONLY** | **FORK** (reference fallback) | viable |

## The two decisive insights

1. **Language splits them cleanly.** Hermes is the more *chorale-native* and has the *deeper self-learning loop*, but its core is **Python** — against the chosen TS stack, and its core lives in 300–768 KB monolithic files that make a long-lived fork expensive. OpenClaw is **pure TypeScript** with an enforced core/plugin boundary and a published `openclaw/plugin-sdk` — far more hackable, and it matches the stack.

2. **Neither hands you the two things that are the *point* of Chorale:**
   - **A clean, single-file, portable agent-authoring format** (goal 5). Hermes uses a *directory convention* (`SOUL.md` + `config.yaml` + `skills/`); OpenClaw uses a *JSON5 config object* (`agents.list[]`). Neither is the Claude-Code-style single `agent.md` you want anyone to be able to drop in.
   - **Chorale orchestration as the central abstraction.** OpenClaw *explicitly refuses* hierarchical multi-agent orchestration as a core concept (VISION: no "manager-of-managers / nested planner trees"). Hermes has more of it (`kanban_chorale`, depth-bounded `delegate_task`) but in Python.

   → **The orchestration layer + the agent format are exactly what you'd own and open-source (goal 5).** They are *not* off-the-shelf in either framework.

## What each framework proves is portable / reusable (regardless of choice)

Both independently converged on the SAME proven patterns — strong signal these are the right designs to adopt:
- **`SKILL.md` + YAML frontmatter (`name`,`description`) + progressive disclosure**, namespaced vendor extras → **Claude skill compatibility is essentially free** and language-agnostic.
- **Declarative provider registry** (Hermes `ProviderProfile`; OpenClaw `openclaw.plugin.json` + `ProviderPlugin`), with a **config-only custom OpenAI-compatible provider** (base_url + key, no code) as the catch-all for Ollama / HF / Fireworks / any endpoint.
- **`mcp_servers` config shape** (command/args/env for stdio; url/headers/transport for http/sse).
- **Two-stage fallback/failover** (auth-profile rotation → model fallback) + **tool-call-repair** (parse plain-text tool calls from weak local models) — critical for goal 3 "works per the LLM's capabilities."
- **SQLite + FTS5 session store** with lineage + compaction.

## Options on the table

**A. Fork OpenClaw → rebrand "Chorale."**
Fastest to a real daily-driver Claude-Desktop replacement. Inherit 50+ providers, MCP client/server, Claude skills, self-healing (retry + tool-call-repair), cron/heartbeat autonomy, plugin SDK — all in TS. Build the chorale-orchestration layer on top.
*Cost:* you own a 24k-file, fast-churning monorepo (mitigate by **freezing the fork + selectively cherry-picking**, not tracking upstream); rebrand is mechanical but wide (`~/.openclaw`, `OPENCLAW_*`, `openclaw.plugin.json`, CLI name); orchestration cuts against its stated design.

**B. Build a lean Chorale core on the Vercel AI SDK, mining both frameworks. ★ recommended**
Own a small codebase you fully understand and can open-source cleanly. Vercel AI SDK gives provider-agnosticism + tool-calling + MCP client out of the box. Port the *self-contained* proven pieces (SKILL.md loader, provider fallback, tool-call-repair, SQLite session store) rather than a whole runtime. Spend your effort on the two differentiators nobody hands you: the **single-file `agent.md` format** and **chorale orchestration**.
*Cost:* slower to feature-parity than a fork; you write the plumbing (but only what you need).

**C. Fork Hermes.**
Deepest self-learning + most chorale-native out of the box, MIT, native Windows.
*Cost:* **Python** (against the TS decision) and monolithic core files — worst on your top-weighted priorities (TS, hackability/ownership). Best treated as **reference-only**.

## Recommendation

**Option B**, for this project's stated values — *ownership, simplicity, "open-source my SDK so anyone can author an agent," and chorale-as-the-core-concept*. Forking OpenClaw (A) is the right call **only if speed-to-daily-driver outweighs owning a lean codebase**, in which case freeze-and-cherry-pick to survive its churn. Hermes (C) is a reference, not a base, because of the Python/monolith mismatch.

Either way, Chorale should **adopt the portable conventions both frameworks validated** (SKILL.md, config-only custom providers, `mcp_servers` shape, fallback + tool-call-repair) so it stays Claude-compatible and model-agnostic from day one.

# Chorale — Roadmap

## Learning & self-healing (agent reliability)

Three mechanisms, exposed as **customizable per-agent tick-boxes** (agent.md frontmatter), on by default for the `coder`:

| Toggle | Status | What it does |
|--------|--------|--------------|
| `fewShot` | ✅ Shipped (Phase 2) | Injects `<name>.examples.md` worked patterns into the prompt (show, don't tell). |
| `selfHeal` | ✅ Shipped (Phase 2) | Runtime self-healing: smoke-boots written servers on an injected port and smoke-imports modules, feeding runtime failures back into the repair loop. |
| `selfLearn` | 🅿️ **Parked for Phase 3** (toggle recognized, currently inert) | Self-learning from past runs. |

### Phase 3 — `selfLearn` (self-learning agents)
The founding "self-improving agent" goal. Sketch:
- **Reflection:** after a task, extract a durable lesson from what worked/failed ("servers must read `process.env.PORT`"; "avoid giant inline HTML template literals — serve from a file").
- **Lessons store:** persist lessons per agent (ties into the memory concept), with provenance and a success/failure signal.
- **Retrieval:** inject the most relevant lessons — and the agent's own past-correct exemplars — into future runs (self-derived few-shot, which beats hand-written).
- **Decay/curation:** prune stale or low-value lessons so the store stays sharp.

Expected payoff: compounding reliability from the agent's own experience, feeding better exemplars back into `fewShot`.

### Known lever, not yet pulled
- `maxVerifyRounds` (currently 3) — some Gemma full-stack failures are template-literal syntax errors it can't repair within 3 rounds; a larger budget (and/or a "serve HTML from a file, not a giant template literal" exemplar) may convert some. Whack-a-mole; escalation remains the reliable path for complex builds.

## Other phase-2 follow-ups (not yet done)
- Ink/TUI renderer for the CLI.
- More agents (files/docs specialist, dedicated verifier).
- Ship phase-2 → PR to `main`.
- Larger, messier real-world codebase benchmarks (beyond the self-contained projects).

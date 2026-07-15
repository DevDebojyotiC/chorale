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

### Compensation that worked (Phase 2)
Gemma's full-stack failure (template-literal syntax errors in inline HTML) was fixed from our
end — **70% → 100% over 20 runs** — by three general measures, not by escalation:
- a **file-based HTML exemplar** in `coder.examples.md` (serve HTML from a `.html` file, don't inline it);
- **targeted repair diagnostics** in `verifyFeedback` (name the backtick cause + prescribe the fix);
- **`maxVerifyRounds` 3 → 5** so a full restructure fits.
Principle: a precisely diagnosed model weakness can be engineered around by (a) steering to a
strategy the model executes reliably, and (b) making repair feedback specific to the failure.

## Hardening — done (Phase 2)
- **Tier 1/2:** per-request timeout + retry/backoff (network resilience), runtime tests via mock model, context-growth guard, cross-platform smoke process cleanup, research-path resilience.
- **Tier 3:** leveled logging + per-session run transcript (`--verbose`/`--quiet`, `data/logs/<session>.log`), secret redaction in all logs, delegation cycle guard, per-session token/cost persistence + `chorale cost`.

## Other phase-2 follow-ups (not yet done)
- Ink/TUI renderer for the CLI.
- More agents (files/docs specialist, dedicated verifier).
- Ship phase-2 → PR to `main`.
- Larger, messier real-world codebase benchmarks (beyond the self-contained projects).

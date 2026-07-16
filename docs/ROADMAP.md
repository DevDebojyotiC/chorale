# Chorale — Roadmap

## Learning & self-healing (agent reliability)

Three mechanisms, exposed as **customizable per-agent tick-boxes** (agent.md frontmatter), on by default for the `coder`:

| Toggle | Status | What it does |
|--------|--------|--------------|
| `fewShot` | ✅ Shipped (Phase 2) | Injects `<name>.examples.md` worked patterns into the prompt (show, don't tell). |
| `selfHeal` | ✅ Shipped (Phase 2) | Runtime self-healing: smoke-boots written servers on an injected port and smoke-imports modules, feeding runtime failures back into the repair loop. |
| `selfLearn` | ✅ Shipped (Phase 3) | Learns fixes from its own successful repairs and injects them proactively next run. See [`self-learning.md`](self-learning.md). |
| `selfCritique` | ✅ Shipped (Phase 4) | The reviewer's form of self-healing: a second pass that validates each finding (drops false alarms) and re-scans for misses, never dropping a security finding. Default-on for the `reviewer`; `CHORALE_NO_CRITIQUE=1` to disable. |
| `reviewGate` | ✅ Shipped (Phase 4) | After a coding agent's code verifies clean, the `reviewer` gives a semantic second opinion; BLOCKER/MAJOR findings loop back for a fix (catches security/logic/async bugs syntax+smoke miss). **On by default** (tick-box) — fires only for agents that write+verify code, so effectively on for the `coder`; the `reviewer` opts out. Set `reviewGate: false` or `CHORALE_NO_REVIEW_GATE=1` to disable. |

### Phase 3 — `selfLearn` (self-learning agents) ✅ v1 shipped
Capture fixes from successful diagnosed repairs → per-agent `data/lessons.sqlite` → inject top proven
lessons proactively next run → prune losers. `chorale lessons` to inspect; `CHORALE_NO_LEARN=1` for
reproducible eval. Full design: [`self-learning.md`](self-learning.md). **v2 (todo):** LLM reflection for
*novel* failures + task-level strategy lessons; promote high-confidence lessons into the diagnose registry.

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

## Phase plan (forward)

Sequencing decision (recorded): **agents before the GUI.** The Ink TUI already provides a working
interactive surface, so a richer GUI is a delivery layer, not a capability gate — and the GUI's design
depends on the agent roster (a reviewer wants inline annotations, a files/docs agent wants a diff panel),
not the reverse. So the roster and core APIs stabilize first; the GUI is built once, against a settled
contract. (The flip case — do the GUI first — only wins if the next milestone is a public launch where
the GUI is the marketing artifact.)

### Phase 3 — self-learning + TUI ✅ (shipping)
`selfLearn` v1, Ink TUI (`chorale tui`, with `onToken`/`onEvent` runtime hooks), pnpm → npm migration
(0 vulnerabilities, pinned deps), and a session-ordering determinism fix (CI flake). A clean, coherent
increment — ready to ship. *Note:* the React/Ink TSX (`src/tui/`) is excluded from `npm run typecheck`
(the native TS7 compiler crashes on React's type tree on Windows); it is type-transpiled by `npm run build`.

### Phase 4 — Core Agents 🔜 (the quintessential capability phase)
Expand Chorale's agent roster — **one agent per task**, each shipped **with its own execution-graded
benchmark** (an agent you can't measure, you can't trust). Proposed lineup, ordered by leverage:

| Task | Agent | Why here |
|------|-------|----------|
| 1 ✅ | **Reviewer / Verifier** | Reviews code & output (correctness / security / style) → structured findings. Compounds the quality of every other agent, so it comes first. **Shipped + hardened with the four mechanisms** (per-model compensation, few-shot, self-heal via a self-critique pass, self-learn): ramp 10/10 · precision 9/9 · multi 8/8 · polyglot 3/3 · expert-security 3/3 (gemma). See [`eval/REVIEWER-SUITES.md`](../eval/REVIEWER-SUITES.md). |
| 2 | **Files / Docs specialist** | File & document work — summarize, generate/refresh docs, organize, edit prose. One of the four product pillars. |
| 3 | **Planner / Architect** | Decomposes a complex request into a plan and delegates it; strengthens the orchestrator. |
| 4 | **Test-writer** | Generates and runs tests — pulls the long-noted "test-execution verification" lever and compounds the coder. |
| 5 | **Productivity** | Email / calendar / notes via MCP — the Claude-Desktop-replacement pillar. |

Closes with a **larger, messier real-world codebase benchmark** exercising the new agents together
(beyond today's self-contained projects). Lineup and order are a proposal — subject to change before/while building.

### Phase 5 — GUI
A richer desktop/web UI over the same UI-agnostic core (built on the `onToken`/`onEvent` hooks), once the
Phase-4 agent roster and core APIs are stable.

### Cross-cutting (any phase)
- `selfLearn` v2: LLM reflection for *novel* failures + task-level strategy lessons; promote high-confidence lessons into the diagnose registry.
- Consider `typescript@7` (native tsgo, crashes on React types) → `typescript@5` to restore TUI typechecking.

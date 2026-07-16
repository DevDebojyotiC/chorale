# Phase 3 — Self-Learning, the TUI, and the Scope Pivot

> **Status:** ✅ complete · **Commits:** `7764c31`…`28b8b56` (merged in `88f08c9`) · **Dates:** 2026-07-15 → 2026-07-16 · **Last updated:** 2026-07-16
>
> A descriptive record of Phase 3: completing the learn/heal/learn triad with **self-learning**,
> adding an interactive **terminal UI** over the same UI-agnostic core, a package-manager
> migration for a clean security posture, a determinism fix, and — importantly — a **deliberate
> scope change** that reshaped the roadmap. Concepts and the reasoning behind each decision are
> emphasized throughout.

---

## 1. What Phase 3 was about

Phase 2 ended with a reliable coder and the compensation thesis proven. Phase 3 had a smaller,
sharper remit: **close the self-improvement loop** the earlier phases had set up, give the system a
**human-facing interactive surface**, and **tidy the foundations** (dependencies, determinism) before
the roster expansion.

Along the way, Phase 3 made a decision that mattered more than any single feature: it **split "more
agents" out into its own phase**. That pivot is why Phase 4 exists as the dedicated "Core Agents"
phase and Phase 5 is the GUI.

---

## 2. Task 1 — Self-learning (`selfLearn`) ✅

Phase 2 shipped two of the three learning mechanisms (`fewShot`, `selfHeal`) and **parked**
`selfLearn`. Phase 3 delivered it.

**What it does.** When the coder successfully fixes a problem via a *diagnosed repair* (a failure the
`diagnose.ts` registry recognized and corrected), it **records that lesson** to a per-agent store
(`data/lessons.sqlite`). On subsequent runs, it **injects the top proven lessons into the prompt
proactively**, so the agent avoids a mistake it has already learned to fix — before making it.
`chorale lessons` inspects the store; `CHORALE_NO_LEARN=1` disables injection for reproducible eval.

**Concept — proactive learning from verified successes.** The key discipline is that a lesson is only
recorded when a repair *actually worked* (verified by the same execution checks), so the store fills
with proven fixes, not speculation. And injection is *proactive* — the lesson is applied on the next
relevant run, not merely available for lookup.

**Why this completes a triad.** The three mechanisms form a loop: **few-shot** (start from known-good
patterns) → **self-heal** (fix failures at runtime this turn) → **self-learn** (remember the fix so it
doesn't recur). Together they are the full "bring the best out of any model" story, and — critically —
they're **model-agnostic**: they make *whatever* model you run better over time, rather than depending
on the model's own weights. Details in [`self-learning.md`](self-learning.md).

**Design note — parked in Phase 2, shipped in Phase 3.** Delivering it later was deliberate: it
depends on the diagnose-and-compensate registry (a Phase-2 late addition) being stable, since a
"lesson" is essentially a persisted, promoted diagnosis. Building it after that settled avoided
churning the store's schema.

---

## 3. Task 2 — The Ink TUI ✅

`chorale tui` is an **interactive streaming chat REPL** built with **Ink** (React for the terminal).
It renders the conversation live as tokens arrive and surfaces agent activity (tool calls,
verify/heal steps, fallbacks).

**The enabling concept — a UI-agnostic core with renderer hooks.** The runtime gained **`onToken`**
and **`onEvent`** callbacks. Instead of the core writing to stdout directly, it *emits* tokens and
structured activity events, and a renderer subscribes. The plain CLI is one renderer; the TUI is
another; a future GUI (Phase 5) will be a third — all over the *same* core.

**Why this design.** It's the load-bearing decision for the eventual GUI. By forcing the runtime to
communicate through `onToken`/`onEvent` rather than `process.stdout.write`, Phase 3 guaranteed the core
stays presentation-independent — so Phase 5 can add a desktop/web UI without touching agent logic. The
TUI is both a useful feature *and* the proof that the hook design works.

**A known constraint, documented honestly.** The React/Ink TSX is **excluded from `npm run
typecheck`** — the native TS7 type-checker crashes on React's type tree on Windows — but it is
type-transpiled by `npm run build`. This is recorded rather than hidden, so a contributor isn't
surprised by it.

---

## 4. Tooling — the pnpm → npm migration ✅

Phase 3 migrated the package manager from **pnpm to npm**: removed the pnpm lockfile and
`packageManager` field, pinned dependencies, added an **`esbuild` override**, and moved CI to
`npm ci`. The result: **`npm audit` reports 0 vulnerabilities**. All docs and comments were updated to
match.

**Why migrate.** Two reasons. First, **security posture** — the override mechanism let us pin a
transitive dependency (`esbuild`) to a non-vulnerable version and get a clean audit, which matters for
a tool people install and run with file/shell access. Second, **distribution simplicity** — npm is the
lowest-common-denominator for a CLI meant to be `npx`-installable by anyone, with no assumption that
they use pnpm. The clean audit became a **quality gate** carried forward: later phases (the scribe's
document libraries, the Phase-4 work) all preserved "0 audit vulnerabilities," pinning `uuid` and
`esbuild` via `overrides` as needed.

---

## 5. Fix — session ordering determinism ✅

`latestSession` / `listSessions` / `pruneSessions` tie-broke **arbitrarily** when two sessions shared
the same-millisecond `updated_at`, which produced a **CI-only flake**. The fix added a monotonic
`rowid` secondary sort, making recency ordering deterministic.

**Why call out a one-line fix.** It's a small but instructive reliability lesson: any ordering keyed on
a timestamp needs a stable tiebreaker, or it will eventually flake under fast/parallel writes. Recording
it keeps the pattern in the team's memory.

---

## 6. The scope change (the decision that reshaped the roadmap)

Phase 3 originally carried a vague "more agents" goal. Midway, that was **promoted out of Phase 3 into
a dedicated Phase 4 — Core Agents**, and the **GUI was pushed to Phase 5**.

**Why split it out.** "More agents" is not one task — it's a *program*: each new specialist deserves
its own persona, its own tools, and (per the project's standard) its own execution-graded benchmark.
Bundling that into Phase 3 alongside self-learning and the TUI would have made the phase unbounded and
under-measured. Carving out **Phase 4 as "one agent per task, each benchmarked"** gave the roster
expansion a clear structure and quality bar. Deferring the **GUI to Phase 5** followed from the same
logic: a UI is only worth building over a *stable* set of agents and APIs — and Phase 3's `onToken`/
`onEvent` hooks had already de-risked it. See [`ROADMAP.md`](ROADMAP.md).

**Consequence.** This pivot is why the rest of the project is shaped the way it is: Phase 4 delivered
the reviewer and scribe agents and is now building the planner + gate framework, each with a benchmark;
Phase 5 remains the GUI, waiting on a settled roster.

---

## 7. Current state at end of Phase 3

| Item | State |
|------|-------|
| Self-learning | ✅ shipped (`data/lessons.sqlite`, proactive injection, `chorale lessons`) |
| Interactive UI | ✅ `chorale tui` (Ink), over `onToken`/`onEvent` hooks |
| Package manager | npm, `npm audit` **0 vulnerabilities**, CI on `npm ci` |
| Determinism | session recency ordering fixed (rowid tiebreak) |
| Roadmap | agents → **Phase 4**, GUI → **Phase 5** |

### Key additions
- `src/core/lessons.ts` + `data/lessons.sqlite` — the self-learn store.
- Runtime `onToken` / `onEvent` renderer hooks; the Ink TUI (`chorale tui`).
- npm migration + `overrides` for a clean audit; deterministic session ordering.

---

## 8. Concept glossary

- **Self-learning (`selfLearn`)** — persist a *verified* diagnosed repair as a lesson; inject the top
  proven lessons proactively on later runs.
- **The learn/heal/learn triad** — `fewShot` (known-good start) → `selfHeal` (fix this turn) →
  `selfLearn` (remember the fix). Model-agnostic self-improvement.
- **UI-agnostic core** — the runtime emits `onToken`/`onEvent`; renderers (CLI, TUI, future GUI)
  subscribe, so the core never assumes a display.
- **Clean-audit quality gate** — `overrides` pin vulnerable transitive deps; `npm audit` stays at 0,
  enforced through every later phase.

---

## 9. Related documents

- [`PHASE-2.md`](PHASE-2.md) — the coder and the compensation mechanisms this phase completed.
- [`PHASE-4.md`](PHASE-4.md) — the "Core Agents" phase this one's scope change created.
- [`self-learning.md`](self-learning.md) — how the lesson store works.
- [`ROADMAP.md`](ROADMAP.md) — the roadmap this phase reshaped.
- [`PHASES.md`](PHASES.md) — the running phase index.

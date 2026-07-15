# Self-Learning (`selfLearn`)

The coder learns from its **own successful repairs** and applies those fixes **proactively** on future
runs — turning the hand-written [diagnose registry](../src/core/diagnose.ts) into a store the agent
extends from experience. Phase 3, Task 1.

## The loop

1. **Capture.** When a *diagnosed* repair round is followed by a clean verify + run, the fix that was
   shown is recorded as a **lesson** — `(agent, error-category key, fix text, win)`. A diagnosed repair
   that never succeeds records a **loss**.
2. **Store.** `data/lessons.sqlite`, per agent, with `uses`/`wins` counts and recency. A *proven* lesson
   is one with `wins > 0`.
3. **Inject.** At the start of each run, the agent's top proven lessons are injected into the system
   prompt under *"Lessons learned from past runs — apply these proactively,"* so it avoids the mistake
   **before** making it. This is self-derived few-shot.
4. **Curate.** Prune lessons that keep being surfaced but never help (`uses ≥ 3`, `0 wins`).

## Design choices

- **Deterministic capture — no extra LLM reflection call.** The lesson text is the `diagnose()` hint
  that preceded success, keyed by the stable error category. Cheap, reliable, and it grows automatically
  as new diagnose rules are added.
- **Reproducibility.** `CHORALE_NO_LEARN=1` disables capture *and* injection; the eval harnesses set it,
  so benchmarks stay deterministic (learning is a *product* behavior, not a benchmark variable).
- **Per-agent.** Lessons are scoped to the agent that learned them.

## Toggle & inspection

- `agent.md`: `selfLearn: true` (default on for the coder; a customizable tick-box).
- `chorale lessons [agent]` — inspect what's been learned (`[key] wins/uses  text`).

## Relationship to the other layers

`diagnose` (hand-written) → `verify`/`selfHeal` (repair loop) → `selfLearn` (remembers which fixes worked
and front-loads them). Few-shot examples, the diagnose registry, and the lessons store are three sources
of the same thing — compensation knowledge — with `selfLearn` the one that compounds automatically.

## Limits / next (v2)

v1 learns only from **diagnosed** errors (known categories). A future reflection step could distill
lessons from *novel* failures and from *task-level* successes (which strategy worked for which task type),
and share high-confidence lessons back into the diagnose registry.

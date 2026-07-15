# Real-Engineering Benchmark — Results

Where the L1→L10 ramp tested single-file algorithmic puzzles, this benchmark tests **multi-file,
multi-step engineering** through Chorale's coder agent — with the coder free to use its full toolset
(including `bash`, so it runs tests and iterates like a real developer). Each project is graded with
**partial credit** by executing the result, not by reading it.

Harness: [`eval/coder-projects.ts`](coder-projects.ts) · Grader self-test: [`eval/projects-selftest.ts`](projects-selftest.ts)
(validates every grader against known-good and known-bad reference solutions before any model is run).

## The four projects

| # | Project | Skill | Checks | What it demands |
|---|---------|-------|:------:|-----------------|
| 1 | **KV store** — `KVStore` with TTL expiry + LRU eviction, across `src/store.mjs` + `src/index.mjs` | Build a library | 8 | Multi-file design, stateful data structure, dependency-injected clock, eviction ordering |
| 2 | **Debug** — fix planted bugs in a broken `lib/` (range, clamp, emitter) until its test suite passes | Debug a codebase | 7 | Read failing tests, localize bugs across files, fix without touching tests |
| 3 | **Async pool** — `runPool(tasks, concurrency)` with bounded concurrency | Async correctness | 5 | Order preservation, concurrency cap, actually parallel, error propagation, in-flight settling |
| 4 | **Todo CLI** — `add / list / done / rm` persisting to `todos.json` | Integration / I/O | 6 | argv parsing, JSON persistence, cross-process state, output contract |

## Results

| Model | KV store | Debug | Async pool | CLI | **Overall** | In tok | Out tok | Time | Cost¹ |
|-------|:--------:|:-----:|:----------:|:---:|:-----------:|-------:|--------:|-----:|------:|
| **Gemma-4-31B** (HF) | 8/8 | 7/7 | 5/5 | 6/6 | **26/26 · 100%** | 124,631 | 8,859 | **32s** | **≈$0.00** |
| gpt-oss-120B (FW) | 8/8 | 7/7 | **4/5** | 6/6 | 25/26 · 96% | 107,600 | 10,111 | 68s | $0.0071 |
| MiniMax-M2.7 (FW) | 8/8 | 7/7 | 5/5 | 6/6 | **26/26 · 100%** | 144,448 | 13,270 | 73s | $0.0246 |

¹ Normalized (cached input + output at Fireworks list rates). Gemma runs on HF (≈$0 per the billing delta).

## Analysis

- **The value king holds up on real engineering.** The headline caveat of the ramp report — *"puzzles
  aren't projects; the frontier models may pull ahead on real work"* — is now tested, and they did **not**
  pull ahead. `Gemma-4-31B` scored a perfect **26/26** across a library build, a cross-file debug, tricky
  async semantics, and a stateful CLI — while being **~2× faster** than either frontier model and effectively
  free. That is a strong, direct validation of Gemma as the default coder.
- **`MiniMax-M2.7` matched it at 100%**, but at **~3.5× the cost** and **~2.3× the time**. Flawless, but you
  pay for it.
- **`gpt-oss-120B` slipped to 96%** — its promise pool **failed to reject when a task threw** (it swallowed
  the error and resolved). A subtle but real error-handling gap; the other three checks (order, concurrency
  bound, in-flight settling) passed. Everything else was perfect.
- **Debugging was universal.** All three read the failing suite, localized the three planted bugs across
  `range.mjs` / `clamp.mjs` / `emitter.mjs`, and fixed them — real multi-file debugging, not pattern-matching.

## What this changes

- **Default `Gemma-4-31B` is validated for real work**, not just puzzles. The earlier "puzzles only" caveat
  is substantially retired for tasks of this shape and size.
- **Escalation nuance:** on real engineering, `MiniMax-M2.7` (100%) was more reliable than `gpt-oss-120B`
  (96%, the async-reject miss), but costs ~3.5×. Since the escalation is only reached when the Gemma default
  fails — which did **not** happen anywhere in this suite — `gpt-oss-120B` remains the cost-first escalation
  pick, with `MiniMax-M2.7` the reliability-first alternative if a task is async-heavy.

## Caveats

1. **N=1 per project.** gpt-oss-120B's single async miss could be run-to-run noise; treat the 100 vs 96
   gap as suggestive, not settled.
2. **Still bounded tasks.** These are real *engineering* (multi-file, stateful, tool-driven, debugged) but
   they are small and self-contained — not multi-thousand-line codebases, ambiguous requirements, or
   long-horizon feature work. The trend is clear at this scale; larger tasks remain future work.
3. **Graders validated up front.** Every grader was checked against reference good/bad solutions
   (`projects-selftest.ts`) so scores reflect the models, not harness bugs. (One such bug — CLI state
   leaking from the model's own test runs — was caught and fixed before the reported run.)

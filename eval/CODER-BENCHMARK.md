# Chorale-Coder — Cross-Model Benchmark

Reproducible benchmark of the `coder` agent (with the verify-repair harness) across models.
Run it yourself: `pnpm exec tsx eval/coder-bench.ts` (needs `HF_TOKEN` / `FIREWORKS_API_KEY`).

## Task
> "Create a folder `demo-todo` with a single self-contained `index.html`: a to-do list app to add and
> remove tasks, tasks persist in localStorage, modern CSS legible in light AND dark themes, vanilla JS
> all inline."

Each model runs in an **isolated temp workspace** with `permissions: full-auto` and the verify-repair
loop **on**. Every run is scored on three axes:
- **wrote** — a file was actually created
- **syntax** — the file passes syntax verification (esbuild / inline-`<script>` check)
- **works** — the app *functions*: loaded headlessly in **jsdom**, a task is added, and we assert a list
  item appears and `localStorage` is populated (the same end-to-end check done manually in a browser)

## Results (2026-07-15)

| Model | wrote | syntax | works | tokens in/out | secs |
|---|:---:|:---:|:---:|---|---:|
| Qwen2.5-7B (HF, small) | ✓ | ✓ | ✓ | 7222 / 1118 | 28 |
| gpt-oss-120B (Fireworks) | ✓ | ✓ | ✓ | 2989 / 1249 | 7 |
| GLM-5.2 (Fireworks) | ✓ | ✓ | ✓ | 8488 / 2465 | 27 |
| Kimi-K2 (Fireworks) | ✓ | ✓ | ✓ | 11044 / 3115 | 54 |

**4 / 4 models produced a working, persistent, verified to-do app** — from a 7B up to premium models.

## Findings
- **The harness lifts every tier.** With the hardened prompt + verify-repair loop, even the small **7B**
  produced a fully functional app — the exact same model that, *without* the harness, shipped broken
  dead-JS code earlier in development.
- **`gpt-oss-120B` was the standout for efficiency** — fastest (7s) and most token-efficient
  (~3k in / 1.2k out) while still fully working.
- **Kimi-K2** was the most thorough/heaviest (11k in / 3k out, 54s); **GLM-5.2** produced the richest UI
  (a 361-line app in earlier manual testing).
- **Reliability vs. capability:** premium models are *consistent*; the 7B is *nondeterministic* — it
  worked this run, but on complex prompts it sometimes emits empty tool arguments (a no-op). The
  verify-repair + no-op-retry mechanisms improve its reliability but cannot make a flaky small model
  100% deterministic. Use a small model for cost, a premium model when reliability matters — and the
  same agent, prompt, and harness serve both.

## Honest limitations & next levers
- **Verification is syntax + a task-specific functional probe** — not general logic verification. Bringing
  a *test-execution* step into the coder's own loop (generate/run a check, not just syntax) would catch
  logic bugs across arbitrary tasks, not just this benchmark's.
- **Single task.** Expanding to a small suite (API client, CLI, refactor, bug-fix) would give per-tier
  data to tune capability-adaptive behavior (step budgets, verification depth) per model.

## Difficulty ladder (2026-07-15)

Five escalating, auto-graded challenges (hidden test suites), local qwen added. Reproduce:
`pnpm exec tsx eval/coder-ladder.ts`. Levels: L1 Roman · L2 Brackets · L3 Expression-evaluator ·
L4 LRU-cache · L5 JSON-parser (no JSON.parse).

| Model | L1 | L2 | L3 | L4 | L5 | ceiling |
|---|:-:|:-:|:-:|:-:|:-:|---|
| qwen3:4b (local) | ⏱ | ⏱ | ⏱ | ⏱ | ⏱ | never completed (200s timeout every level) |
| Qwen2.5-7B | ✓ | ✓ | ✓ | ✗ | ✗ | L3 (L4 dup-declaration, L5 runtime crash) |
| gpt-oss-120B | ✓ | ✓ | ✓ | ✓ | ✓ | 5/5, fastest |
| GLM-5.2 | ✓ | ✓ | ✓ | ✓ | ✓ | 5/5 |
| Kimi-K2 | ✓ | ✓ | ✓ | ✓ | ⏱ | L4 (L5 timeout, not wrong) |

### Takeaways
- The harness is not the ceiling for capable models: **gpt-oss-120B and GLM-5.2 solved all 5**, incl. a
  from-scratch JSON parser. The field never fully broke within 5 levels.
- **Local 4 GB is non-viable for agentic coding** — timed out on even L1.
- **Two actionable harness gaps found:** (1) esbuild syntax-check is more lenient than Node's ESM parser
  (missed a duplicate-declaration bug) → verify with `node --check`/real import; (2) syntax ≠ correctness
  (a runtime `undefined` crash) → add test-execution verification to the coder loop.

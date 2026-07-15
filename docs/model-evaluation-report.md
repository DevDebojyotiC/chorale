# Chorale Coder — Model Evaluation Report

**A head-to-head evaluation of 11 language models as the coding engine behind Chorale's `coder` agent, measured on correctness, speed, and true per-task cost.**

*Prepared for the Chorale project · Ramp: L1→L10 algorithmic ladder · Method: single-file code generation through the production coder pipeline*

---

## TL;DR

- **Eleven models** were run through the identical L1→L10 coding ladder inside Chorale's real coder agent (salvage + verify pipeline), one run per level.
- **Seven models scored a perfect 10/10.** Correctness *saturates* on these tasks — so the decision comes down to **speed and cost**, where the models diverge by more than an order of magnitude.
- **Value winner & default: `Gemma-4-31B` (Hugging Face)** — 9/10 at **≈$0** and **13 seconds** total. It one-shots almost everything with no repair rounds. The nearest 10/10 model is **7–10× slower**.
- **Best escalation: `gpt-oss-120B` (Fireworks)** — the **cheapest 10/10** at **~$0.013** for the whole ramp, and among the fastest. It has been wired in as the heavy-tier fallback behind Gemma.
- **The premium models earned nothing here.** `GLM-5.2` and `Kimi-K2.6` cost **~18×** more than `gpt-oss-120B` for the *same* score; `DeepSeek-V4-Pro` and `MiniMax-M3` ~10×. Bigger, pricier, and slower bought no additional correctness on this ladder.

---

## 1. Context & Goal

Chorale is a model-agnostic, multi-agent system: any agent can be pointed at any model — local (Ollama) or serverless (Hugging Face, Fireworks, Anthropic) — with no code change. The `coder` agent is the flagship. The design goal is explicit: **bring the best out of any model, from the smallest local model to the largest frontier model, and route work to the best value option.**

This evaluation answers a concrete question that arose in practice: *among the models we can actually reach, which should the coder default to, and which is worth escalating to when the default falls short?* The honest, data-driven answer required running the same workload through every candidate and measuring what it actually costs and delivers — not reading a billing dashboard, which we found to be misleading.

## 2. What Was Tested — The L1→L10 Ladder

Each level asks the coder to produce a single, self-contained ES-module (`solution.mjs`) that exports one function or class. The levels escalate in algorithmic difficulty:

| Level | Task | What it stresses |
|------:|------|------------------|
| L1 | Roman numeral conversion | Basic mapping & loops |
| L2 | Balanced-bracket validator | Stack logic, edge cases (`([)]`) |
| L3 | Arithmetic expression evaluator | Operator precedence, parsing |
| L4 | LRU cache (class) | Stateful data structure, eviction order |
| L5 | JSON parser (no `JSON.parse`) | Recursive descent, string escapes |
| L6 | Regex matcher (`.` and `*`) | Recursion/DP, backtracking |
| L7 | Topological sort | Graph traversal, cycle detection |
| L8 | CSV parser (quotes, escapes, newlines) | Stateful text parsing |
| L9 | Mini-interpreter (variables + arithmetic) | Statefulness across statements |
| L10 | Dijkstra shortest path | Weighted graph + priority queue |

**Grading is behavioral, not textual.** Each solution is imported and run against hidden test cases. The grader resolves the export leniently (exact name → `default` → the sole callable export), so a cosmetic name mismatch (e.g. `intToRoman` vs `toRoman`) never masks otherwise-correct logic. A level passes only if every assertion holds.

## 3. Methodology

**The pipeline is the real one.** Models run through Chorale's production coder agent, including its content-level **tool-call salvage** (recovers file writes that weak models emit as text/JSON/backticked blocks), **syntax verify-and-repair loop** (esbuild-checks each file and feeds errors back with escalating temperature), and **auto-export rescue**. This means the numbers reflect *the coder as shipped*, not a raw API call.

**Metrics captured per level:** pass/fail, wall-clock seconds, and input/output token counts (summed across all fallback and repair attempts).

**Cost model.** Raw billing-dashboard totals are unreliable — they bundle prior-session usage and vary with prompt-cache hit rates. So cost here is **normalized**: recomputed from *this ramp's* measured token counts × each model's Fireworks list rates, charging input at the cached rate (production-realistic, since the ~3k-token system prompt is reused every turn) plus output at the output rate. This is reproducible and free of historical contamination. It cross-checks against the billed accrued figures within caching variance. `Gemma-4-31B` runs on Hugging Face (not on these Fireworks rate cards); its earlier HF billing delta showed the whole ramp at **<$0.01**.

**Honesty about scope.** This is **N=1 per level** — a single run. Frontier models are fairly deterministic, so the 10/10 results are trustworthy, but the 9-vs-10 boundary is one run wide. More importantly: **these are single-file algorithmic puzzles, not real software engineering.** They do not exercise multi-file projects, debugging loops, or long-horizon agentic tool use — precisely where the largest frontier models are designed to shine. This report ranks *puzzle-solving inside the coder pipeline*, and says so plainly.

## 4. Models Under Test

| Model | Provider | Context | Input $/M (uncached / cached) | Output $/M |
|-------|----------|--------:|------------------------------:|-----------:|
| Gemma-4-31B | Hugging Face | ~128k | — (HF) | — (HF) |
| gpt-oss-120B | Fireworks | 131k | $0.15 / $0.01 | $0.60 |
| gpt-oss-20B | Fireworks | 131k | $0.07 / $0.04 | $0.30 |
| DeepSeek-V4-Flash | Fireworks | 1M | $0.14 / $0.03 | $0.28 |
| DeepSeek-V4-Pro | Fireworks | 1M | $1.74 / $0.15 | $3.48 |
| MiniMax-M2.7 | Fireworks | 196k | $0.30 / $0.06 | $1.20 |
| MiniMax-M3 | Fireworks | 512k | $0.30 / $0.06 | $1.20 |
| Qwen3.7-Plus | Fireworks | ~256k | $0.40 / $0.08 | $1.60 |
| Nemotron-3-Ultra (NVFP4) | Fireworks | 262k | $0.60 / $0.12 | $2.40 |
| GLM-5.2 | Fireworks | 1M | $1.40 / $0.14 | $4.40 |
| Kimi-K2.6 | Fireworks | 262k | $0.95 / $0.16 | $4.00 |

## 5. Results

### 5.1 Per-level pass grid

| Model | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | L9 | L10 | Score |
|-------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:---:|:-----:|
| Gemma-4-31B | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | **9/10** |
| gpt-oss-120B | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **10/10** |
| DeepSeek-V4-Flash | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **10/10** |
| MiniMax-M2.7 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **10/10** |
| Qwen3.7-Plus | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **10/10** |
| DeepSeek-V4-Pro | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **10/10** |
| MiniMax-M3 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **10/10** |
| GLM-5.2 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **10/10** |
| Kimi-K2.6 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **10/10** |
| gpt-oss-20B | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | **9/10** |
| Nemotron-3-Ultra | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | **7/10** |

### 5.2 Master comparison — score, speed, tokens, cost

Sorted by score, then normalized cost. **Ramp $** = normalized cost for the full L1→L10 run (cached input + output at list rates). **Out $/M** is the output list price — the dominant cost driver.

| Model | Score | Total time | Input tok | Output tok | Out $/M | **Ramp $** |
|-------|:-----:|-----------:|----------:|-----------:|--------:|-----------:|
| **Gemma-4-31B** | **9/10** | **13s** | 31,663 | 6,036 | (HF) | **≈$0.00** |
| gpt-oss-120B | 10/10 | 130s | 127,322 | 18,649 | $0.60 | **$0.013** |
| DeepSeek-V4-Flash | 10/10 | 457s | 281,863 | 25,017 | $0.28 | $0.016 |
| MiniMax-M2.7 | 10/10 | 96s | 156,820 | 17,270 | $1.20 | $0.030 |
| Qwen3.7-Plus | 10/10 | 122s | n/a¹ | n/a¹ | $1.60 | ~$0.09¹ |
| DeepSeek-V4-Pro | 10/10 | 437s | 283,613 | 23,595 | $3.48 | $0.125 |
| MiniMax-M3 | 10/10 | 571s | n/a¹ | n/a¹ | $1.20 | ~$0.14¹ |
| GLM-5.2 | 10/10 | 417s | 343,559 | 40,927 | $4.40 | $0.228² |
| Kimi-K2.6 | 10/10 | 693s | 311,697 | 49,082 | $4.00 | $0.246² |
| gpt-oss-20B | 9/10 | 136s | 29,769 | 10,817 | $0.30 | $0.004 |
| Nemotron-3-Ultra | 7/10 | 312s | 71,541 | 11,184 | $2.40 | $0.035 |

¹ Fireworks reported no token usage for Qwen3.7-Plus / MiniMax-M3; their figures are the billed ramp-only accrued cost (clean — neither was used in prior sessions).
² **Decontaminated.** Raw dashboard totals were GLM $0.60 and Kimi **$2.75**, but those bundled earlier-session usage. Recomputed from *this ramp's* tokens, Kimi's true cost is ~$0.25 — expensive, but ~18× the cheap tier, not the ~90× the raw total implied.

## 6. Analysis

### 6.1 Correctness saturates — the interesting axis is efficiency
Seven of eleven models scored a perfect 10/10, and the two 9/10 results (Gemma, gpt-oss-20B) each miss a single, different level. On this ladder, raw capability is effectively a solved problem for any competent model. That flips the decision entirely onto **cost and speed**, where the field spreads across **more than an order of magnitude**.

### 6.2 Cost is an output-pricing story
Normalized ramp cost ranges from **~$0.004 to ~$0.25** — a **~60× spread for identical results.** The driver is almost entirely **output token pricing**, which ranges **$0.28/M (DeepSeek-V4-Flash) to $4.40/M (GLM-5.2) — a 15.7× range** — multiplied by how many tokens each model emits. The "reasoning-heavy" models (GLM, Kimi, DeepSeek) lose twice: they charge the most per output token *and* generate the most of them.

### 6.3 Speed tells the same story
Total wall-clock for the ten levels spans **13 seconds (Gemma) to 693 seconds (Kimi-K2.6) — a 53× range.** The fast models (Gemma 13s, MiniMax-M2.7 96s, Qwen3.7-Plus 122s, gpt-oss-120B 130s) one-shot solutions. The slow ones burn minutes per level on internal reasoning that, here, changes no outcome.

### 6.4 The value tiers

- **Tier 1 — Default (near-free):** `Gemma-4-31B`. 9/10, ≈$0, 13s. In a class of its own on value.
- **Tier 2 — Escalation (cheap 10/10):** `gpt-oss-120B` (~$0.013), `DeepSeek-V4-Flash` (~$0.016), `MiniMax-M2.7` (~$0.030). Perfect scores at trivial cost. `gpt-oss-120B` is the pick — cheapest *and* fast, with transparent usage.
- **Tier 3 — Premium (overpriced here):** `DeepSeek-V4-Pro` (~$0.125), `MiniMax-M3` (~$0.14), `GLM-5.2` (~$0.23), `Kimi-K2.6` (~$0.25). Same 10/10 for **10–18×** the Tier-2 cost. No justification on this workload.
- **Underwhelming:** `Nemotron-3-Ultra (NVFP4)` — **7/10 and ~$0.035**, i.e. it pays more than gpt-oss-120B for a *worse* score. The NVFP4 4-bit quantization appears to cost real accuracy (it failed L3, L4, and L9).

### 6.5 Notable findings

- **Bigger isn't better within a family.** `MiniMax-M2.7` (96s, ~$0.03) and `MiniMax-M3` (571s, ~$0.14) score identically, but the newer, larger M3 is **~6× slower and ~3× more expensive** for zero gain.
- **"Flash" is a misnomer.** `DeepSeek-V4-Flash` is the cheapest 10/10 by output rate, but it was one of the *slowest* models in our pipeline (457s) — it reasons heavily. Cheap, but not fast.
- **The small sleeper.** `gpt-oss-20B` scored 9/10 at **~$0.004** — nearly free — tripping only on the L6 regex matcher. A credible ultra-budget option.
- **Gemma's one gap is diagnostic.** The single level Gemma misses — **L9, a stateful mini-interpreter** — is exactly the kind of task the escalation model exists for. Every 10/10 model handles it.

## 7. The Decision

The data supports a two-model heavy-tier architecture, now wired into Chorale:

> **Default: `Gemma-4-31B` → Escalate: `gpt-oss-120B`**

- Gemma handles 9/10 of this workload at near-zero cost and interactive speed — the right default for the overwhelming majority of turns.
- `gpt-oss-120B` sits directly behind it as the heavy-tier fallback: the cheapest perfect scorer, fast, and transparent — the right model for the hard cases (like stateful interpreters) where Gemma slips.
- The premium models (`GLM-5.2`, `Kimi-K2.6`, `DeepSeek-V4-Pro`, `MiniMax-M3`) are **not** in the default path. They earned no measurable advantage on this ladder to justify their 10–18× cost.

## 8. Limitations & Honest Caveats

1. **N=1 per level.** Single runs. The 10/10 results are trustworthy given frontier determinism, but the 9-vs-10 line could move by one level on a re-run.
2. **Puzzles, not projects.** The L1→L10 tasks are single-file algorithmic puzzles. They do *not* measure multi-file work, debugging, or heavy tool use. **→ This limitation has since been tested directly — see §11, the Real-Engineering Addendum — and the frontier models did *not* pull ahead of Gemma.**
3. **Cost is normalized, not billed.** Figures are recomputed from measured tokens × list rates (cached input + output). Real bills vary with actual cache-hit rates. GLM-5.2 / Kimi-K2.6 dashboard totals were excluded as contaminated by prior-session use; Gemma runs on HF (≈$0 per the billing delta).
4. **Two models report no token usage** (Qwen3.7-Plus, MiniMax-M3) via the Fireworks API; their cost is the billed ramp-only accrued figure.

## 9. Reproducibility

```bash
# Single model, open-ended ramp (streams a live log, stops on failure/slowness)
npx tsx eval/coder-ramp.ts "hf:google/gemma-4-31B-it"

# Head-to-head bake-off across N models, L1..MAX, full pass grid + tokens
npx tsx eval/coder-bakeoff.ts 10 \
  "hf:google/gemma-4-31B-it" \
  "fireworks:accounts/fireworks/models/gpt-oss-120b" \
  "fireworks:accounts/fireworks/models/minimax-m2p7"
```

Harness: [`eval/coder-bakeoff.ts`](../eval/coder-bakeoff.ts) · Challenges & grader: [`eval/challenges.ts`](../eval/challenges.ts) · Condensed board: [`eval/RAMP-LEADERBOARD.md`](../eval/RAMP-LEADERBOARD.md)

---

## 11. Addendum — Real-Engineering Validation

The ramp above measures single-file puzzles. To test the caveat head-on, the three finalists were run through a **multi-file, multi-step engineering** benchmark: build a library, debug a broken codebase, get async concurrency right, and ship a stateful CLI — with the coder using its full toolset (including `bash`, so it runs tests and iterates like a developer). Each project is graded with **partial credit** by executing the result; every grader was validated against reference good/bad solutions first.

| Project | Skill | Checks |
|---------|-------|:------:|
| KV store (TTL + LRU, multi-file) | Build a library | 8 |
| Fix a broken `lib/` until tests pass | Debug a codebase | 7 |
| Bounded-concurrency promise pool | Async correctness | 5 |
| Todo CLI with JSON persistence | Integration / I/O | 6 |

| Model | KV | Debug | Async | CLI | **Overall** | Time | Cost |
|-------|:--:|:-----:|:-----:|:---:|:-----------:|-----:|-----:|
| **Gemma-4-31B** | 8/8 | 7/7 | 5/5 | 6/6 | **26/26 · 100%** | **32s** | **≈$0.00** |
| gpt-oss-120B | 8/8 | 7/7 | 4/5 | 6/6 | 25/26 · 96% | 68s | $0.0071 |
| MiniMax-M2.7 | 8/8 | 7/7 | 5/5 | 6/6 | **26/26 · 100%** | 73s | $0.0246 |

**Findings.** The value king holds up: **Gemma-4-31B scored a perfect 26/26** on real multi-file engineering — a library build, a cross-file debug, tricky async semantics, and a stateful CLI — while being **~2× faster** than either frontier model and effectively free. **MiniMax-M2.7 also went 100%**, but at ~3.5× the cost and ~2.3× the time. **gpt-oss-120B slipped to 96%** — its promise pool failed to reject when a task threw (a real error-handling gap); everything else was perfect. On this evidence the "frontier models justify their cost on real work" hypothesis does **not** hold at this task scale — Gemma matches or beats them. Full detail: [`eval/PROJECTS-RESULTS.md`](../eval/PROJECTS-RESULTS.md). *(Caveat: still N=1, and these are small self-contained projects, not thousand-line codebases.)*

---

*Chorale is an open-source, model-agnostic multi-agent system. This report reflects measurements taken through its production coder pipeline; numbers will shift as models, prices, and the pipeline evolve.*

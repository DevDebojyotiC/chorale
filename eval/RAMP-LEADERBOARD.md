# Coder Ramp Leaderboard — L1→L10

Single-file algorithmic ramp run through the Chorale **coder** agent (salvage + verify
pipeline), one run per level (N=1). Grades by resolved export, so a cosmetic name
mismatch doesn't mask correct logic. Harness: [`eval/coder-bakeoff.ts`](coder-bakeoff.ts),
challenges: [`eval/challenges.ts`](challenges.ts).

Levels: **L1** roman · **L2** brackets · **L3** expr-eval · **L4** LRU · **L5** JSON parser ·
**L6** regex(`.`/`*`) · **L7** toposort · **L8** CSV · **L9** mini-interpreter · **L10** Dijkstra.

## Leaderboard

Cost is **normalized**: recomputed from the measured L1–L10 token counts × Fireworks list
rates (input at the cached rate + output), which is production-realistic (the ~3k-token system
prompt is reused/cached every turn) and — unlike the raw dashboard total — free of prior-session
usage. It cross-checks against billed accrued within caching variance. `Out $/M` is the output
list price, the structural cost driver. Sorted by score, then normalized cost.

| Model | Provider | Score | Time | Out $/M | Ramp $¹ | Missed |
|---|---|---:|---:|---:|---:|---|
| **Gemma-4-31B** | HF | **9/10** | **13s** | (HF) | **≈$0.00**² | L9 |
| gpt-oss-120B | FW | 10/10 | 130s | $0.60 | **$0.013** | — |
| DeepSeek-V4-Flash | FW | 10/10 | 457s | $0.28 | **$0.016** | — |
| MiniMax-M2.7 | FW | 10/10 | 96s | $1.20 | $0.030 | — |
| Qwen3.7-Plus | FW | 10/10 | 122s | $1.60 | ~$0.09³ | — |
| DeepSeek-V4-Pro | FW | 10/10 | 437s | $3.48 | $0.125 | — |
| MiniMax-M3 | FW | 10/10 | 571s | $1.20 | ~$0.14³ | — |
| GLM-5.2 | FW | 10/10 | 417s | $4.40 | $0.228⁴ | — |
| Kimi-K2.6 | FW | 10/10 | 693s | $4.00 | $0.246⁴ | — |
| gpt-oss-20B | FW | 9/10 | 136s | $0.30 | $0.004 | L6 |
| Nemotron-3-Ultra (NVFP4) | FW | 7/10 | 312s | $2.40 | $0.035 | L3, L4, L9 |

¹ `(input_tok × cached_in_rate) + (output_tok × output_rate)` over the whole L1–L10 run.
  At full uncached input the ceilings are higher (e.g. GLM $0.66, Kimi $0.49, DS-V4-Pro $0.58),
  but the output-only floor — cache-independent — already tells the story: $0.003 (gpt-oss-20B)
  → $0.196 (Kimi), a **65× spread** for identical 10/10 results.
² HF, not on these rate cards; earlier billing deltas showed the whole ramp ran at <$0.01.
³ Fireworks reported no token usage for Qwen3.7-Plus / MiniMax-M3, so these are the billed
  ramp-only accrued figures (clean — neither was used in prior sessions).
⁴ **Decontaminated:** the raw dashboard showed GLM $0.60 and Kimi **$2.75**, but those totals
  bundled earlier-session usage. Recomputed from *this ramp's* tokens, Kimi's true cost is
  ~$0.25 — expensive, but ~11× the cheap tier, not the ~90× the raw total implied.

## Verdict (with real dollars)

The headline: **identical 10/10 correctness spans ~$0.013 → ~$0.25** (normalized) — a **~20×
cost gap for the same result**, driven almost entirely by output pricing (**$0.28 → $4.40/M,
a 15.7× range**). Paying more bought nothing here.

- **Best value / default:** **Gemma-4-31B** — 9/10 at ≈$0 and 13s. Still uncontested; the
  cheapest 10/10 (gpt-oss-120B, ~$0.013) is 10× slower and not free. Keep it the default.
- **Best frontier escalation:** **gpt-oss-120B** — ~$0.013, 130s, 10/10. Cheapest 10/10 *and*
  near the fastest, with transparent usage and a rock-bottom $0.60/M output rate. It replaces
  MiniMax-M2.7 as the recommended escalation: M2.7 (96s) is faster but ~2× the cost; DeepSeek-
  V4-Flash matches on price but is 3.5× slower. gpt-oss-120B is the best balance.
- **The premium trap, in dollars:** GLM-5.2 (~$0.23) and Kimi-K2.6 (~$0.25) cost **~18×**
  gpt-oss-120B for the identical score — because their output is $4.00–4.40/M *and* they emit
  the most tokens. DeepSeek-V4-Pro (~$0.125) and MiniMax-M3 (~$0.14) are ~10× the cheap tier.
  None earned their premium on this ramp.
- **Underwhelming:** Nemotron-3-Ultra (NVFP4) — 7/10 *and* ~$0.035 (more than gpt-oss for a
  worse score). gpt-oss-20B (9/10, ~$0.004) is the sleeper — nearly free, only tripping on L6.
- The one level Gemma misses (**L9**, a stateful mini-interpreter) is caught by every 10/10
  model — that's the case to escalate on.

## Caveats

1. **N=1 per level.** Frontier models are fairly deterministic (trust the 10/10s), but the
   9/10 vs 10/10 line is one run wide.
2. **Algorithmic puzzles ≠ real engineering.** Every model aces single-file puzzles. The
   frontier models' real edge (multi-step agentic coding, debugging, multi-file refactors)
   does **not** show here. This ranks puzzle-solving, not project work.
3. **Costs are real Fireworks accrued spend** for the ramp, except GLM-5.2 / Kimi-K2.6 (whose
   totals include prior-session use) and Gemma-4-31B (HF, ≈$0). Qwen3.7-Plus and MiniMax-M3
   report no token usage via the API, but their dollar cost is itemized.

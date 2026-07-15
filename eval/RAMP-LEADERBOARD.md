# Coder Ramp Leaderboard — L1→L10

Single-file algorithmic ramp run through the Chorale **coder** agent (salvage + verify
pipeline), one run per level (N=1). Grades by resolved export, so a cosmetic name
mismatch doesn't mask correct logic. Harness: [`eval/coder-bakeoff.ts`](coder-bakeoff.ts),
challenges: [`eval/challenges.ts`](challenges.ts).

Levels: **L1** roman · **L2** brackets · **L3** expr-eval · **L4** LRU · **L5** JSON parser ·
**L6** regex(`.`/`*`) · **L7** toposort · **L8** CSV · **L9** mini-interpreter · **L10** Dijkstra.

## Leaderboard

Cost is the **actual Fireworks accrued spend** for the ramp (all 10 levels), not a token
proxy. Sorted by score, then by cost.

| Model | Provider | Score | Time | Ramp cost | Missed | Note |
|---|---|---:|---:|---:|---|---|
| **Gemma-4-31B** | HF | **9/10** | **13s** | **≈$0.00**² | L9 | **best value — near-free, 7–50× faster than any 10/10** |
| DeepSeek-V4-Flash | FW | 10/10 | 457s | **$0.02** | — | cheapest 10/10, but slow |
| gpt-oss-120B | FW | 10/10 | 130s | **$0.03** | — | **best frontier value — cheap AND fast** |
| MiniMax-M2.7 | FW | 10/10 | 96s | $0.05 | — | fastest 10/10 |
| Qwen3.7-Plus | FW | 10/10 | 122s | $0.09 | — | fast; no usage reported by FW |
| MiniMax-M3 | FW | 10/10 | 571s | $0.14 | — | ~3× the cost & 6× the time of M2.7, same score |
| DeepSeek-V4-Pro | FW | 10/10 | 437s | $0.21 | — | 10× DeepSeek-Flash's cost for the identical result |
| GLM-5.2 | FW | 10/10 | 417s | ($0.60)³ | — | cost includes prior-session use — not ramp-clean |
| Kimi-K2.6 | FW | 10/10 | 693s | ($2.75)³ | — | slowest; cost includes prior-session use |
| gpt-oss-20B | FW | 9/10 | 136s | ~$0.01⁴ | L6 | solid, cheap small model |
| Nemotron-3-Ultra (NVFP4) | FW | 7/10 | 312s | $0.09 | L3, L4, L9 | worst frontier — pays more for a lower score |

² HF, not itemized here; earlier billing deltas showed the whole ramp ran at <$0.01.
³ GLM-5.2 and Kimi-K2.6 were used in earlier sessions too, so these totals overstate the
  ramp's share — excluded from the value ranking.
⁴ gpt-oss-20B wasn't itemized in the Fireworks breakdown; ~$0.01 by size/token count.

## Verdict (with real dollars)

The headline: **identical 10/10 correctness spans $0.02 → $0.21** among ramp-clean models —
a **10× cost spread for the same result** (and up to $2.75 for Kimi). Paying more bought
nothing here.

- **Best value / default:** **Gemma-4-31B** — 9/10 at ≈$0 and 13s. Still uncontested; the
  cheapest 10/10 (DeepSeek-Flash, $0.02) is 35× slower and not free. Keep it the default.
- **Best frontier escalation:** **gpt-oss-120B** — $0.03, 130s, 10/10. Cheap *and* fast, with
  transparent usage. This replaces MiniMax-M2.7 as the recommended escalation now that real
  cost is in: M2.7 ($0.05, 96s) is a touch faster but ~60% pricier; DeepSeek-Flash ($0.02) is
  a touch cheaper but 3.5× slower. gpt-oss-120B is the best balance of the three.
- **The premium trap:** DeepSeek-V4-Pro ($0.21) costs **10×** DeepSeek-Flash for the same
  score; MiniMax-M3 ($0.14) costs **~3×** M2.7 and runs 6× slower; GLM-5.2 and Kimi-K2.6 are
  pricier still. None earned their premium on this ramp.
- **Underwhelming:** Nemotron-3-Ultra (NVFP4) — 7/10 *and* $0.09, i.e. more money for a worse
  score. gpt-oss-20B (9/10, ~$0.01) is the sleeper — nearly free, only tripping on L6 regex.
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

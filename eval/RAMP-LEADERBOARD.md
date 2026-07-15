# Coder Ramp Leaderboard — L1→L10

Single-file algorithmic ramp run through the Chorale **coder** agent (salvage + verify
pipeline), one run per level (N=1). Grades by resolved export, so a cosmetic name
mismatch doesn't mask correct logic. Harness: [`eval/coder-bakeoff.ts`](coder-bakeoff.ts),
challenges: [`eval/challenges.ts`](challenges.ts).

Levels: **L1** roman · **L2** brackets · **L3** expr-eval · **L4** LRU · **L5** JSON parser ·
**L6** regex(`.`/`*`) · **L7** toposort · **L8** CSV · **L9** mini-interpreter · **L10** Dijkstra.

## Leaderboard

| Model | Provider | Score | Total time | Out tokens | Missed | Note |
|---|---|---:|---:|---:|---|---|
| **Gemma-4-31B** | HF | **9/10** | **13s** | **6,036** | L9 | **best value — ≈$0, 7–50× faster than any 10/10** |
| MiniMax-M2.7 | FW | 10/10 | 96s | 17,270 | — | **fastest 10/10 — best frontier value** |
| Qwen3.7-Plus | FW | 10/10 | 122s | n/a¹ | — | fast; provider reports no usage |
| gpt-oss-120B | FW | 10/10 | 130s | 18,649 | — | measurable + cheap on FW |
| DeepSeek-V4-Pro | FW | 10/10 | 437s | 23,595 | — | perfect but ~4.5× slower |
| DeepSeek-V4-Flash | FW | 10/10 | 457s | 25,017 | — | "Flash" is a misnomer — slow, token-heavy |
| GLM-5.2 | FW | 10/10 | 417s | 40,927 | — | reasoning model; token-heavy |
| MiniMax-M3 | FW | 10/10 | 571s | n/a¹ | — | same 10/10 as M2.7 but ~6× slower — bigger sibling, no better |
| Kimi-K2.6 | FW | 10/10 | 693s | 49,082 | — | slowest, most tokens |
| gpt-oss-20B | FW | 9/10 | 136s | 10,817 | L6 | solid small model |
| Nemotron-3-Ultra (NVFP4) | FW | 7/10 | 312s | 11,184 | L3, L4, L9 | worst frontier — NVFP4 4-bit likely hurts |

¹ Fireworks returns no token usage for this model, so per-token cost can't be measured via the API.
  (Qwen3.7-Plus and MiniMax-M3 both report no usage.)

## Verdict

- **Best value / default:** **Gemma-4-31B** — 9/10 at ~$0 and 13s. Nothing else is within
  7× on speed. Keep it as the default heavy tier.
- **Best frontier (correctness + efficiency):** **MiniMax-M2.7** — 10/10, fastest of the
  perfect scorers (96s), lean tokens. Edges out gpt-oss-120B for the escalation slot.
  Its bigger sibling **MiniMax-M3** also scores 10/10 but at 571s (~6× slower) for no gain —
  a clean example that within a family, the smaller model can be the better agent here.
- **Perfect but not worth it here:** GLM-5.2, Kimi-K2.6, DeepSeek-V4-Pro/Flash all hit
  10/10 but burn 2–3× the tokens and 4–7× the wall-time of MiniMax/gpt-oss for the same result.
- **Underwhelming:** Nemotron-3-Ultra (NVFP4) at 7/10 — the 4-bit quant appears to cost real
  accuracy. gpt-oss-20B (9/10) is a strong small option, only tripping on L6 regex.
- The single level Gemma misses (**L9**, a stateful mini-interpreter) is caught by every
  10/10 model — that's the case to escalate on.

## Caveats

1. **N=1 per level.** Frontier models are fairly deterministic (trust the 10/10s), but the
   9/10 vs 10/10 line is one run wide.
2. **Algorithmic puzzles ≠ real engineering.** Every model aces single-file puzzles. The
   frontier models' real edge (multi-step agentic coding, debugging, multi-file refactors)
   does **not** show here. This ranks puzzle-solving, not project work.
3. **Cost is token-proxied.** Confirm dollars against the Fireworks billing delta; Qwen3.7-Plus
   reports no usage at all.

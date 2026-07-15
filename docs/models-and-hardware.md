# Local Models & Hardware — Chorale Guide

> Which local models to run for each agent role on constrained VRAM, grounded in
> both community research and Chorale's own **measured** benchmark results.
> Maps directly onto [model profiles](model-profiles.md) and `chorale init`.

## TL;DR for ≤4 GB VRAM
- **Coding:** `qwen2.5-coder:3b` (Q4_K_M, ~1.9 GB) — **measured**: fits, ~15 s, writes correct code. The pick.
- **Chat/general:** `qwen2.5:3b` or `llama3.2:3b` (Q4_K_M, ~2.2 GB).
- **Utility (tiny/fast):** `llama3.2:1b`.
- Run **one at a time** (a single model + context ≈ your whole 4 GB). Use the `local-single` profile,
  or accept ~10–30 s reloads with `local-varied`.
- **Reasoning models** (`deepseek-r1-distill…`, thinking `qwen3`) are a *niche* on 4 GB — see caveat below.

## Tier table

| Chorale tier | Top pick | Alt | Quant / VRAM | Notes |
|---|---|---|---|---|
| **code** | **Qwen2.5-Coder-3B** ⭐ | Qwen2.5-Coder-1.5B | Q4_K_M ~1.9–2.3 GB | *Measured winner.* 1.5B = max-headroom fallback. **Avoid Q3** (quality cliff). |
| **chat** | Qwen2.5-3B | Llama-3.2-3B | Q4_K_M ~2.2 GB | Strong instruction-following + JSON. |
| **research** | Qwen2.5-3B / Coder-3B | — | Q4_K_M ~2.2 GB | Needs decent tool-use; pair with Tavily. |
| **reason** | DeepSeek-R1-Distill-Qwen-1.5B | — | Q8_0 ~1.8 GB | Great *standalone* math/logic; risky *for agents* (see below). |
| **utility** | Llama-3.2-1B | Qwen2.5-1.5B | Q8_0 ~1.3–1.8 GB | Tiny, instant; renaming/summarizing/aux. |
| **RAG** (context-heavy) | Qwen2.5-1.5B | — | Q8_0 ~1.7 GB | 32K context, but see KV-cache note. |

## What we actually measured (not spec sheets)

From Chorale's difficulty-ladder + single-task benchmarks on a 4 GB machine:

| Model | Result | Why |
|---|---|---|
| **qwen2.5-coder:3b** (Q4, ~1.9 GB) | ✅ **fast + correct** (~15 s, passed) | Fits fully in 4 GB; code-tuned. **Recommended local coder.** |
| qwen3:4b (2.5 GB) | ❌ minutes / timeouts | 2.5 GB doesn't fit 4 GB → CPU offload → ~10× slower. Thinking made it worse. |
| phi4-mini (3.8B) | ❌ broken/empty code | A *reasoning* model, not a coder; also produced malformed tool calls. |

Two takeaways the spec sheets miss:
1. **Model size vs. available VRAM is a cliff, not a slope.** A 2.5 GB model on 4 GB (after the OS/browser take their cut) doesn't run "a bit slower" — it offloads to CPU and becomes ~10× slower. Stay ≤ ~2 GB of weights.
2. **Tool-calling reliability is a *separate axis* from quality.** For agents, a model that writes perfect code but emits its tool call as *text* (not a structured call) does nothing. We saw exactly this with qwen2.5-coder. Chorale's **content-level tool-call salvage** recovers those, which is what makes small local models usable as agents at all.

## The reasoning-model caveat (for agents)
`DeepSeek-R1-Distill` and thinking `qwen3` are genuinely strong at math/logic for their size. But for **agentic** use in Chorale:
- Their `<think>` loops are **slow on 4 GB** and **blow up the context/KV cache** (we watched this stall qwen3:4b for minutes).
- Reasoning models often **tool-call poorly**.
So treat them as a **dedicated "hard-problem" reasoner you invoke deliberately**, not a general driver. Disabling their thinking (Chorale supports `extraBody: { think: false }` on the ollama provider) defeats their purpose.

## VRAM sizing reference

| Params | Quant | ≈ Weights | Verdict on 4 GB |
|---|---|---|---|
| 1.5B | Q4_K_M | ~1.1 GB | max speed / most context headroom |
| 1.5B | Q8_0 | ~1.8 GB | accuracy sweet spot |
| 3B | Q4_K_M | ~1.9–2.3 GB | **works** (measured) — the ceiling |
| 3B | Q3_* | ~1.9 GB | avoid — quality cliff below Q4 |
| 4B+ | any | ≥2.5 GB | **too big for 4 GB** — spills to CPU |

**Context (KV cache) also costs VRAM.** A "32K context" model won't hold 32K on 4 GB alongside 2 GB of weights — realistically **4–8K comfortable**. Keep threads short; lower `num_ctx` if generation drops to ~1 tok/s (that's a spill to system RAM).

## Pro-tips (confirmed)
- **Ollama / LM Studio** (both llama.cpp) — best for constrained VRAM.
- **Close browsers before heavy local runs.** Chrome/Vivaldi/Brave each hog 0.5–1 GB of VRAM for GPU-accelerated tabs — often the exact margin between a model fitting and spilling.
- **Watch context bloat** — agentic tool outputs fill the KV cache fast.
- **Ollama env levers:** `OLLAMA_KEEP_ALIVE` (how long a model stays warm) and `OLLAMA_MAX_LOADED_MODELS` (how many resident).

## How this maps to Chorale profiles

This table *is* a `local-varied` profile (tier → model). Two hardware realities:
- **4 GB:** only one model fits → use `local-single` (pin `qwen2.5-coder:3b`), or accept reloads with `local-varied`. If you have API keys, `hybrid-1L-1S` keeps light work local and sends heavy coding/research to a serverless model (no VRAM contention).
- **6–8 GB:** because these picks are tiny (1–2 GB each), you can keep **2–3 resident at once** → *real* local multi-agent specialization with little swapping. Raise `OLLAMA_MAX_LOADED_MODELS`.

`chorale init` reads your installed models + keys and generates a fitting profile from this guidance.

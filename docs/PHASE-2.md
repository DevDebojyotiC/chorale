# Phase 2 — The Coder, the Model Evidence, and Hardening

> **Status:** ✅ complete · **Version:** v0.2.0 · **Commits:** 32 tasks (`3519031`…`a612433`, merged in `b708d9e`) · **Tests:** 93 · **Last updated:** 2026-07-16
>
> A descriptive record of Chorale's largest phase to date: the coder agent, the whole
> weak-model-robustness apparatus, the evidence-based model decision, the learning/self-healing/
> compensation mechanisms, and the Tier 1–3 hardening that made v0.2.0 shippable. Emphasis on the
> concepts and *why* each decision was made.

---

## 1. What Phase 2 set out to prove

Phase 1 proved Chorale could *run any model*. Phase 2 had to prove it could **do real engineering
work reliably on cheap, open models** — because the entire value proposition (local-first, model-
agnostic, low-cost) collapses if you actually need a frontier API to get anything done.

So Phase 2 is really two efforts braided together:

1. **Build a coder agent** that writes, edits, and runs code in a sandbox.
2. **Make weak/local models reliable enough** to be that coder — and *prove it with numbers*.

The through-line, which becomes the project's signature thesis, is: **compensate for a small model's
weaknesses with structure (salvage, verify-repair, diagnostics, few-shot, self-heal) rather than
paying for a bigger model.** Phase 2 is where that thesis was earned with benchmarks.

---

## 2. The coder agent & weak-model robustness

### 2.1 The coder and the verify-repair loop

The **coder** is an agent with sandboxed file and shell tools and a **verify-repair loop**: after it
writes code, the runtime runs an esbuild syntax check; if it fails, the errors are fed back to the
model (with escalating temperature across rounds) until it compiles or a repair budget is exhausted.

**Concept — mechanical verification as a gate.** The model's output isn't trusted blindly; a
deterministic check (does it parse?) gates it, and failures become targeted feedback. This is the
coder's version of "don't just generate — verify," and it's the ancestor of every later gate/check in
the project (the scribe's `groundCheck`, the reviewer gate, the Phase-4 gate framework).

### 2.2 Content-level tool-call salvage (the local-model unlock)

Many local models **don't emit native tool calls** — they write the tool call as prose, JSON, or a
fenced code block instead. Without handling this, a local model simply can't act. Phase 2 added
**content-level tool-call salvage**: the runtime parses tool calls the model wrote as text and
executes them. It is:

- **Backtick/template-literal aware** — so code containing backticks doesn't break parsing.
- **Filename-tagged-fence aware** — a fence like ```` ```solution.mjs ```` is treated as a file write.
- Equipped with an **`ensureExports` rescue** (repair missing module exports) and a **no-op retry**
  (re-prompt when a weak model emits an empty/invalid tool call).

**Why this matters.** This single capability is what makes small local models *usable at all* as
agents. It's the difference between "only frontier models with native tool-calling work" and "your
7B–31B local model can drive the coder." Much of Phase 2's later success rests on it.

### 2.3 Stream filtering and provider quirks

- A **stream filter** strips leaked tool-call markup from the streamed output so the user sees clean
  text, not the model's internal tool syntax.
- Per-provider **`extraBody`** controls provider-specific behavior (e.g. disabling Ollama's "thinking"
  mode) — again, configuration rather than special-case code.

---

## 3. Model routing & setup

### 3.1 Model profiles

**Model profiles** are named routing policies with a precedence order:

```
--model  >  profile.agents  >  profile.tiers  >  profile.default  >  agent.md  >  base
```

**Concept — routing as policy, not per-agent hard-coding.** A profile lets a user say "route all
`code`-tier work to model X, everything else to Y" in one place, and override per-agent or per-run
when needed. This is what makes Chorale adapt to *whatever* models a given user actually has.

### 3.2 `chorale init` and tiered init

**`chorale init`** detects the user's installed Ollama models and available API keys and **generates a
tailored, tiered profile from their *actual* models**, suggesting `ollama pull` for gaps. `docs/
models-and-hardware.md` gives measured local-model + VRAM guidance.

**Why.** Model-agnosticism is only real if setup meets the user where they are. Rather than shipping a
fixed model list, Chorale inspects the machine and writes a profile that fits it — the practical face
of "runs on your models."

---

## 4. Benchmarks & the model decision (the evidence)

This is the heart of Phase 2: not opinions about models, but **execution-graded evidence**.

### 4.1 The harnesses

Multiple benchmark harnesses, all **execution-graded with partial credit and self-validated graders**
(the graders are verified to score correctly with no model calls):

- an **open-ended difficulty ramp** (L1→L10),
- a **head-to-head bake-off**,
- a **real-engineering** suite of multi-file, tool-driven projects.

**Why execution-grading.** A benchmark that scores prose about code is worthless; these run the code
and check it works. Partial credit avoids all-or-nothing noise, and self-validated graders mean the
scoreboard itself is trustworthy.

### 4.2 What the numbers said

- **L1–L10 ramp across 11 models** → 7 models hit 10/10. **Correctness saturates** at this difficulty,
  so once several models are all "correct," the deciding axes become **cost and speed**. Reports in
  MD/HTML/PDF (`docs/model-evaluation-report.*`).
- Costs were **normalized per-token**, and GLM/Kimi totals were **decontaminated** of prior-session
  usage so the dollar figures were honest.

### 4.3 The decisions (evidence-backed)

- **Default heavy tier = Gemma-4-31B** — 9/10 on the ramp, effectively **$0**, and fast.
- **Escalation = gpt-oss-120B** — the **cheapest model to reach a perfect 10/10** (~$0.013/run).
- **Premium models earned nothing at this scale** — GLM-5.2, Kimi-K2.6, DeepSeek-V4-Pro, and
  MiniMax-M3 showed no advantage that justified their cost/latency on this work.

**Why these two.** The pairing encodes the project's economics: a free, fast default that's good
enough for the vast majority of tasks, plus a cheap, reliable escalation for the hard ones. Paying
for a premium model bought no measured benefit — a conclusion only a real benchmark could license.

### 4.4 The crossover insight

The **real-engineering benchmark** (multi-file, tool-driven) revealed a **difficulty crossover**:

- On **routine** work, *value* wins — Gemma is perfect and free.
- On **hard/full-stack** work, *reliability* wins — gpt-oss was 100% across trials while Gemma's
  full-stack attempts were flaky.

**Why this matters.** It reframes "which model is best?" as "best *for what difficulty*?" — and it
directly motivates the escalation tier and the compensation work below (can we make the cheap model
reliable on the hard end too?).

---

## 5. Learning, self-healing & compensation

Having found *where* the cheap model was flaky, Phase 2 set about **fixing the model's weaknesses from
our side** — the compensation thesis, made concrete.

### 5.1 The tick-box mechanisms

Per-agent, default-on for the coder:

- **`fewShot`** — inject `coder.examples.md` worked patterns into the prompt (showing beats telling).
- **`selfHeal`** — a runtime **smoke test**: boot written servers on an injected PORT, smoke-import
  modules, and repair failures at runtime (not just at compile time).
- **`selfLearn`** — parked here, shipped in Phase 3 (learn fixes and apply them proactively).

**Concept — capability toggles.** Each mechanism is an independent, measurable switch, so its effect
can be benchmarked in isolation rather than bundled into an opaque "smarter agent."

### 5.2 Diagnosing and fixing Gemma's full-stack weakness (70% → 100%)

The flaky full-stack case was **root-caused**: large HTML embedded in a JS template literal produced a
**nested backtick**, which broke the generation. The fix was **not model-specific** — it (a) steered
the model toward file-based HTML, (b) added **targeted repair diagnostics**, and (c) gave a **bigger
repair budget**. Result: **70% → 100%** on that case.

**Why this is the whole philosophy in one story.** The instinct would be "Gemma is too weak, use a
bigger model." Instead we found the *actual* failure mode and removed it with general engineering —
turning a flaky cheap model into a reliable one, for free.

### 5.3 Generalized diagnose-and-compensate

That one fix was generalized into an **extensible diagnostics registry** (`src/core/diagnose.ts`) that
maps any recognized syntax/runtime error to a "cause + fix" hint, **model-agnostic**. New failure
modes are added as registry entries, and every agent benefits.

---

## 6. Hardening (Tiers 1–3)

To be shippable as v0.2.0, the system was hardened across three tiers:

- **Network resilience** — per-request timeout plus retry/backoff on 429/5xx/transient errors
  (timeouts fall back rather than blindly retry).
- **Runtime tests** — a mock-model harness exercising the fallback chain, plus unit tests for the
  resilience helpers.
- **Context-growth guard** — keep the conversation under a char/token budget so long repair chains or
  resumed sessions can't overflow the window or balloon cost.
- **Cross-platform process cleanup** (smoke tests kill spawned servers on all OSes), **research-path
  resilience** (web-fetch retry + clear degradation).
- **Leveled logging + per-session run transcript**, **secret redaction**, a **delegation cycle
  guard**, and **per-session token/cost accounting** with a `chorale cost` command.

**Why a dedicated hardening pass.** The difference between a demo and a tool is the unhappy paths —
network flakes, runaway context, leaked secrets, orphaned processes, delegation loops. Phase 2 treated
those as first-class work, not afterthoughts.

---

## 7. CLI & docs (ship readiness)

- **CLI ergonomics:** `--help` / `--version`, `chorale agents`, `chorale doctor` (provider ping),
  stdin piping, `--json`, `sessions rm/prune`. Shipped as **v0.2.0**.
- **Documentation suite:** `PHASES.md`, `COMMIT-LOG.md`, `ARCHITECTURE.md`, `PROJECT-STATE.md`, and a
  refreshed README.
- A late cleanup removed "personal" framing from the publishable reports so the generated artifacts
  are shareable.

---

## 8. Current state at end of Phase 2

| Item | State |
|------|-------|
| Version | **v0.2.0** (merged via PR #1) |
| Tests | **93 passing** |
| Provider health | ollama / fireworks / hf reachable |
| Default model | `gemma-4-31B` (≈$0, fast) |
| Escalation | `gpt-oss-120B` (cheapest 10/10, ~$0.013) |
| Coder | verify-repair + salvage + self-heal + few-shot; full-stack case 100% after compensation |

### Key modules introduced
- The coder agent + its sandboxed file/shell tools and verify-repair loop.
- Content-level tool-call salvage (`src/core/tool-call-salvage.ts`) and the stream filter.
- Model profiles + `chorale init` (tiered profile generation).
- The benchmark harnesses (`eval/`) and the model-evaluation reports (`docs/model-evaluation-report.*`).
- `src/core/diagnose.ts` (diagnose-and-compensate), smoke testing, logging, redaction, cost accounting.

---

## 9. Concept glossary

- **Verify-repair loop** — write → syntax-check → feed failures back with rising temperature → repeat.
- **Content-level tool-call salvage** — parse+execute tool calls a model wrote as text/JSON/fences;
  what makes non-native-tool-calling local models usable.
- **Model profile** — a named routing policy resolved by a strict precedence order.
- **Tiered init** — generate a profile from the machine's *actual* installed models.
- **Execution-graded benchmark** — runs the produced code and scores it, with partial credit and
  self-validated graders.
- **Difficulty crossover** — value (cheap model) wins on routine work; reliability (escalation) wins on
  hard work.
- **Compensation** — remove a cheap model's failure mode with general engineering instead of a bigger
  model (the project's signature move).
- **Tick-box mechanisms** — `fewShot` / `selfHeal` / `selfLearn`: independently toggled, independently
  measured.

---

## 10. Related documents

- [`PHASE-0-1.md`](PHASE-0-1.md) — the foundation this phase built on.
- [`PHASE-3.md`](PHASE-3.md) — self-learning, the TUI, and the npm migration.
- [`model-evaluation-report.md`](model-evaluation-report.md) — the model bake-off evidence.
- [`models-and-hardware.md`](models-and-hardware.md) — local-model + VRAM guidance.
- [`engineering-benchmark-report.md`](engineering-benchmark-report.md) — the real-engineering benchmark.
- [`PHASES.md`](PHASES.md) — the running phase index.

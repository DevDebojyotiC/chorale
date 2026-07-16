# Reviewer agent — benchmark results

The `reviewer` agent (Phase 4, Task 1) is graded on **planted-defect fixtures**: each is a small
code sample with a known defect (or a clean control). We measure **recall** (planted defects caught)
and **precision** (no false BLOCKER/MAJOR on correct code). Grader validated by
[`reviewer-selftest.ts`](reviewer-selftest.ts) with no model calls.

Run: `npx tsx eval/reviewer-bench.ts ["<provider:model>" …]` · fixtures + grader in [`reviewer-fixtures.ts`](reviewer-fixtures.ts).

## Fixtures
| id | plant | severity class |
|----|-------|----------------|
| `sql-injection` | query built by string concatenation | security |
| `off-by-one` | `arr[arr.length]` for the last element | correctness |
| `missing-await` | returns `.id` off an unawaited Promise | reliability |
| `hardcoded-secret` | API key literal in source | security |
| `unguarded-null` | property access with no null guard | reliability |
| `clean-clamp` | correct `clamp` — **control, no defect** | precision |

## Result — default model (`hf:google/gemma-4-31B-it`, ≈$0)
**Recall 5/5 defects · precision 1/1 clean — stable across 3 runs (~4–5s each).**

## The calibration fix (compensating for a model weakness, from our end)
The first run caught all 5 defects but raised a **false MAJOR** on the correct `clamp` — it escalated a
*defensive-programming* suggestion (validate `min <= max`, a caller precondition) to REQUEST CHANGES. An
over-eager reviewer that always demands changes gets ignored.

Fixed with two **general, model-agnostic** measures (not tuned to the benchmark):
1. a **Calibration** section in `agents/reviewer.md` — a BLOCKER/MAJOR must name a concrete failing input on
   a realistic path; validating a caller's precondition is a NIT, never MAJOR;
2. a **few-shot exemplar** (`agents/reviewer.examples.md`) showing restraint on correct code — using a
   *different* function (`fullName`) than the benchmark's held-out `clamp` control, so the improvement
   reflects generalization, not memorization.

Precision went 0/1 → **1/1** while recall stayed **5/5** — `clamp` is now correctly `APPROVE WITH NITS`.

## More suites + the four mechanisms
This is the base precision/recall bench. The reviewer is further stress-tested on:
- a **10-level subtlety ramp** ([`REVIEWER-RAMP.md`](REVIEWER-RAMP.md)) — gemma stable **10/10** after the security checklist;
- **precision / multi-defect / polyglot / expert** suites, plus the **four robustness mechanisms**
  (per-model compensation, few-shot, self-heal via a self-critique pass, self-learn) — full write-up in
  [`REVIEWER-SUITES.md`](REVIEWER-SUITES.md).

## Caveats
Small, single-file fixtures with one planted defect each; N is small. This measures review *quality*
(inlined code, no tool use) — the agent's file-reading and optional `bash` verification are exercised in
normal CLI use, not here.

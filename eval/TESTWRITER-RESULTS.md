# Test-writer — benchmark & results

The `test-writer` writes **and runs** tests for code that already exists. Its whole value is tests
that would **catch a bug** — so it is graded by **mutation**, the gold standard for test quality: a
generated suite must **pass on the correct implementation AND fail on every planted buggy mutant.** A
suite that goes green on both is worthless, and that is exactly the failure mode this benchmark exists
to expose.

Run:
- `npx tsx eval/testwriter-selftest.ts` — validate the grader by running `node --test` on real files
  (**no model calls**; works without credentials).
- `npx tsx eval/testwriter-bench.ts ["<provider:model>" …]` — run the live test-writer and grade its
  suites by mutation.

## What is graded (`eval/testwriter-fixtures.ts`)
Each fixture is a small function with a spec, a **correct** implementation, and a set of **mutants**
(plausible bugs). A generated suite is scored:

| Metric | Meaning |
|--------|---------|
| **clean pass** | the suite passes on the correct implementation (no false failures) |
| **kill rate** | fraction of mutants the suite *fails* on — i.e. bugs it would catch |
| **good** | clean pass **and** every mutant killed (kill rate 100%) |

## Fixtures & mutants
| fixture | function | mutants (planted bugs) |
|---------|----------|------------------------|
| `clamp` | `clamp(x, lo, hi)` | no clamping · ignores the upper bound · wrong comparison operator |
| `sum` | `sum(arr)` | off-by-one initial value · no initial value (empty array throws) |
| `title-case` | `titleCase(s)` | doesn't lower-case the rest · only capitalizes the first word |

## The verification edge (why this agent is trustworthy)
Two things distinguish the test-writer from a model that just emits `*.test` files:
1. **It runs the tests** (execution, not generation) — via `bash`, iterating until they pass on the
   correct code. Its `verify` tick-box also syntax-checks the test file.
2. **A firm no-cheat rule** in the persona: *never weaken a test to make it green.* If a test fails
   because the code is wrong, that's a **bug found** — reported, with the correct failing test kept —
   not papered over by matching the buggy output. The mutation benchmark is what proves the tests
   aren't trivially green.

## Grader self-validation (deterministic, always runnable)
`testwriter-selftest.ts` proves the grader discriminates, with **no model calls**:
- every fixture's hand-authored **gold suite** passes clean and **kills all mutants**;
- a **trivial suite** (`assert.ok(true)`) passes clean but **kills nothing** → correctly graded
  *not good*. That asymmetry — green is not good enough — is the whole point.

Regression-protected in `test/testwriter.test.ts` (part of `npm test`).

## Live results
`testwriter-bench.ts` runs the actual agent per fixture (writes `target.test.mjs`, runs it), then
grades the produced suite by mutation. It needs provider credentials; when the model chain is
unavailable it reports "no suite produced" and the deterministic self-test stands as the proof.
*(Live scorecard to be filled in on a run with credentials.)*

## Notes
- Grading uses the built-in `node:test` runner, so fixtures/tests need no dependencies.
- Small fixture set; the grader measures the *correctness signal* (passes clean, catches planted
  bugs), not subjective test-style quality.

# Reviewer difficulty ramp — L1→L10

A 10-level ramp for the `reviewer` agent where **difficulty = how hard the planted defect is to *see***
(not how big the program is). L1 is a common gotcha; L10 is a security trap that needs specialist
knowledge. Each level has exactly one real, planted defect, graded by curated signature terms so a vague
review can't score. Grader validated with no model calls ([`reviewer-selftest.ts`](reviewer-selftest.ts)).

Run: `npx tsx eval/reviewer-ramp.ts ["<provider:model>" …]` (no args → gemma-4-31B + gpt-oss-120B).
Fixtures + grader: [`reviewer-fixtures.ts`](reviewer-fixtures.ts).

## The ramp
| Level | Defect | Why it's hard to catch |
|-------|--------|------------------------|
| L1 | `Array#sort()` without a comparator on numbers | common gotcha (default string order) |
| L2 | pagination `slice(start, start + size + 1)` | boundary math hidden in a slice |
| L3 | `forEach(async …)` — returns before inserts finish | async control flow |
| L4 | `d * 100` cents total | floating-point money, looks right |
| L5 | `var i` captured in a closure | classic closure-over-var |
| L6 | `"./docs/" + name` file read | path traversal (security) |
| L7 | `memoize` that ignores its arguments | subtle logic — caches first result forever |
| L8 | `await get` then `await set` | TOCTOU race / lost update (concurrency) |
| L9 | `/^(\w+\s?)+$/` on untrusted input | ReDoS / catastrophic backtracking (security) |
| L10 | recursive `deepMerge` over untrusted JSON | prototype pollution via `__proto__` (security) |

## Baseline (reviewer as first shipped) — N=2–3/level
| Model | Recall | Ceiling | Miss | Speed |
|-------|--------|---------|------|-------|
| gemma-4-31B | **9/10** | L9 | **L10** prototype pollution (3/3 runs) | ~8s |
| gpt-oss-120B | **9/10** | L8 | **L9** ReDoS (2/2 runs) | ~90–120s |

**Finding — complementary blind spots:** at baseline the two models failed on *different* security classes —
gemma consistently missed prototype pollution, gpt-oss consistently missed ReDoS. Both are canonical
vulnerability classes (CWE-1321, CWE-1333) a world-class reviewer must always scan for.

## Compensation (from our end, general — not tuned to the fixtures)
Added a **standard security vulnerability-class checklist** to `agents/reviewer.md` — injection, path
traversal, **prototype pollution**, **ReDoS**, unsafe deserialization/`eval`, SSRF/open redirect, secrets &
authz. This is a real senior-reviewer mental checklist: it makes the reviewer scan for these classes in *any*
code, so a passing result reflects the reviewer now *knowing to look*, not memorizing a fixture.

## After compensation — multi-run
| Model | Runs | Result | Speed | Cost |
|-------|------|--------|-------|------|
| **gemma-4-31B** | 3 | **10/10 every run — perfect & stable** | ~7–8s | ≈$0 |
| gpt-oss-120B | 4 | 9–10/10 (two 10/10; two 9/10, misses drifting L8/L2) | ~90–150s | ~cents |

gpt-oss's remaining variance is a **consistency** issue, not a knowledge gap — its misses scatter across
levels run-to-run (it dropped even the easy L2 once), whereas gemma is a flat 10/10 after the checklist.

## Verdict
For the reviewer, **gemma-4-31B is the default and the winner**: after one general compensation it scores a
stable **10/10**, 13–18× faster than the frontier model, at ≈$0. gpt-oss-120B knows the same material but is
slower and less consistent on the hardest tiers — reasonable as an optional second opinion, not a necessity.
This mirrors the coder result: the agent's compensation layer lets the cheap, fast model match or beat the
frontier one.

## Caveats
Single-file fixtures, one planted defect each; N is small (2–4 runs/level). Term-match grading measures
whether the reviewer *named* the defect class, not the full quality of its explanation. Precision (not
over-flagging correct code) is covered by the base bench ([`REVIEWER-RESULTS.md`](REVIEWER-RESULTS.md)).

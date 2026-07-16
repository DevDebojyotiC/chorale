# Reviewer — full benchmark suites & the four robustness mechanisms

Making Chorale's reviewer world-class means more than high recall on obvious bugs. A great reviewer must
also **resist false alarms**, **find every bug in a messy file**, **handle multiple languages**, catch
**expert-level** security defects, and **self-correct**. So the reviewer is tested across five suites and
hardened with the same four mechanisms as the coder — *compensate for each model's weakness, few-shot,
self-heal, self-learn*.

Harnesses (all execution-graded, graders self-validated with **no model calls** by
[`reviewer-selftest.ts`](reviewer-selftest.ts)):
- [`reviewer-bench.ts`](reviewer-bench.ts) — base recall/precision · [`reviewer-ramp.ts`](reviewer-ramp.ts) — L1→L10 subtlety ramp ([`REVIEWER-RAMP.md`](REVIEWER-RAMP.md))
- [`reviewer-suite.ts`](reviewer-suite.ts) — precision / multi / polyglot / expert ([`reviewer-suites.ts`](reviewer-suites.ts))
- [`reviewer-critique-ab.ts`](reviewer-critique-ab.ts) — self-critique on/off ablation

## Suites
| Suite | What it probes | Fixtures |
|-------|----------------|----------|
| **Ramp** | recall vs. rising subtlety (default-sort → prototype pollution) | 10 |
| **Precision** | false-positive resistance on tricky-but-**correct** code (safe regex vs ReDoS, `== null`, `??` for 0, `>>>`, bitmask, `structuredClone`) | 9 clean |
| **Multi** | finds **all** defects in one messy file (2–3 planted each) | 3 |
| **Polyglot** | non-JS (Python: mutable default, f-string SQLi, bare `except`) | 3 |
| **Expert** | subtle security (timing attack, unverified JWT, SSRF) + one adversarial **correct** case | 3 + 1 |

## Scorecard (single-pass base ability)
| Suite | gemma-4-31B (default) | gpt-oss-120B |
|-------|-----------------------|--------------|
| Ramp (recall) | **10/10** | **10/10** |
| Precision | **9/9** | 8–9/9 |
| Multi | **8/8** | **8/8** |
| Polyglot | **3/3** | **3/3** |
| Expert (recall) | **3/3** | 2–3/3 |

Both models are near-perfect; the remaining flaps are single fixtures on the hardest tiers (run-to-run
variance), which the self-critique pass recovers (below). gemma matches gpt-oss at ≈$0 and ~13× faster.

## The four mechanisms (each measured, each earned)

**1 · Compensate for each model's weakness.** Every gap found was closed by a *general* fix, not fixture-tuning:
- **Security vulnerability-class checklist** in the persona (injection, path traversal, prototype pollution,
  ReDoS, unsafe deserialization, SSRF, broken signature/token verification, timing attacks, secrets/authz).
  Closed the baseline blind spots — gemma's prototype pollution, gpt-oss's ReDoS, and gemma's occasional
  miss of unverified-token/timing on the expert tier.
- **ReDoS safe-vs-dangerous criterion** — flag only *ambiguous/overlapping* repetition (`(a+)+`, `(\w+\s?)+`),
  never a linear pattern (`(ab)+`, `^[a-z0-9-]+$`). Fixed a false ReDoS alarm **without** losing real-ReDoS recall.
- **Calibration rule** — a BLOCKER/MAJOR must name a concrete failing input on a realistic path; defensive
  validation of a caller's precondition is a NIT.

**2 · Few-shot** ([`agents/reviewer.examples.md`](../agents/reviewer.examples.md), `fewShot: true`). Three
calibrated exemplars — decisive on a real bug, restrained on a caller-precondition, restrained on
*intentional/commented* error suppression. The third killed a shared false positive (both models had
over-escalated deliberate fire-and-forget telemetry to MAJOR) — taught on a **held-out** snippet, so it
generalizes rather than memorizes.

**3 · Self-heal = a self-critique second pass** (`selfCritique: true`; disable with `CHORALE_NO_CRITIQUE=1`).
After the draft review, the model re-examines it: keep well-supported findings, downgrade/drop only clearly
unsupported non-security ones, and re-scan for misses. **Guardrail: it never removes or downgrades a security
finding.** A/B ablation (`reviewer-critique-ab.ts`):
- **Recall safety net** — recovered a missed expert defect on gpt-oss (**2/3 → 3/3**); never dropped a
  security finding after the guardrail was added.
- **Precision** — roughly neutral (the hard adversarial-telemetry case flips both ways); the reliable
  precision wins come from the calibration rule + few-shot, not the second pass.
- Cost: one extra model call per review — cheap on the ≈$0 default model; `CHORALE_NO_CRITIQUE=1` for
  single-pass runs (the base benchmarks use it for reproducibility + cost).

**4 · Self-learn** (`selfLearn: true`). Proven lessons are injected into the prompt (shared per-agent
`LessonStore`, as for the coder). Capture uses a **sound signal**: when the self-critique pass surfaces a
security class the first draft missed, that "I overlooked this" is recorded as a proactive lesson so future
reviews scan for it up front. (A reviewer has no runtime ground-truth like the coder's "does it run", so
capture is scoped to this critique-recovery signal; broader experience-learning needs a human/downstream
feedback signal — tracked as future work.)

## Production review modes
Beyond reviewing snippets, the reviewer works the way real reviews happen:

- **Diff review** (`DIFF` suite; `chorale review [--staged] [paths…]`) — judge a unified diff: catch
  regressions the *change* introduces (dropped guard, flipped comparison, typo'd field), don't flag
  pre-existing issues, APPROVE a correct change. gemma **3/3** regressions + correct-change APPROVEd.
  `chorale review` runs it on your `git diff` or given files.
- **Multi-file cross-contract** (`MULTIFILE`; `eval/reviewer-multifile.ts`) — bugs that only show *across*
  files (wrong argument order, a field the producer doesn't return, an unawaited async result). The
  reviewer **reads the files via its tools** and reasons across them. gemma + gpt-oss both **3/3 recall ·
  1/1 precision**.
- **Coder review gate** (`reviewGate` toggle, on for the coder; `eval/reviewer-gate-demo.ts`) — after the
  coder's code verifies clean (syntax + smoke), the reviewer gives a **semantic second opinion**; any
  BLOCKER/MAJOR loops back for a fix. Live demo: the coder wrote SQL injection → gate caught it →
  next round the gate caught a missing `await` → final code is parameterized + awaited, clean in 2 rounds.
  Catches the security/logic/async bugs that syntax + smoke can't. Disable with `CHORALE_NO_REVIEW_GATE=1`.

## Honest caveats
Single-file fixtures, small N (2–4 runs/level). Term-match grading measures whether the reviewer *named* the
defect class, not the full quality of its prose. The self-critique pass is a recall backstop with neutral
precision — not a silver bullet; the durable wins are the per-model compensations + few-shot.

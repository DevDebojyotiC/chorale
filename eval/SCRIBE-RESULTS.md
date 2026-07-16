# Scribe (Files/Docs specialist) — benchmark results

The `scribe` generates, edits, summarizes, and organizes a project's documents — grounded strictly in the
real files. It's benchmarked on the failure modes that actually matter for doc work, each with an objective,
self-validated grader ([`scribe-selftest.ts`](scribe-selftest.ts), no model calls).

Run: `npx tsx eval/scribe-bench.ts [ground|stale|edit|all] ["<model>" …]` · fixtures + graders in
[`scribe-fixtures.ts`](scribe-fixtures.ts).

## Suites
| Suite | What it measures |
|-------|------------------|
| **Groundedness** | Generate a README for a real project → **precision** (invented path refs, via `checkGroundedness` — should be 0) + **recall** (documents the real public API). The dominant doc failure is hallucination, so precision is the headline. Runs an A/B on the `groundCheck` pass. |
| **Staleness** | Docs planted with inaccuracies (a renamed symbol, a dead link, a wrong version) → does the scribe catch each? |
| **Edit safety** | Fix prose grammar while **preserving technical facts** → typos removed, numbers/ports kept verbatim. |

## Scorecard (single-pass)
| Suite | gemma-4-31B (default) | gpt-oss-120B |
|-------|-----------------------|--------------|
| Groundedness — invented refs | **0** | **0** |
| Groundedness — API recall | **2/2** | 0/2 † |
| Staleness detection | **3/3** | **3/3** |
| Edit safety (facts preserved) | **✓** | **✓** |

**gemma (the default) is perfect across every suite.** † gpt-oss scored 0/2 on groundedness recall because in that
run it did not actually *write* the README file (its precision/hallucination is still perfect, and it edits and
audits fine — staleness 3/3, edit ✓). Same pattern as the reviewer: the cheap, fast default model is the more
reliable choice; the frontier model is flappier on file-creation. N is small.

## What the benchmark caught and fixed (from our end)
- **`groundCheck` (anti-hallucination)** — after the scribe writes docs, `checkGroundedness` verifies every path
  the docs claim exists actually exists, and loops back to fix invented ones. On these fixtures gemma already
  writes grounded docs (0 invented, with and without the pass), so groundCheck is a safety net here rather than a
  visible lift; it's the guardrail against the failure mode.
- **"Use your tools" persona rule** — the scribe first refused a staleness audit ("no files were provided") instead
  of reading the workspace. A forceful rule (the project is the CWD; always `ls`/`read`/`grep` it yourself, never
  claim files are absent) plus an explicit **staleness-audit procedure** (grep each named symbol, verify each link,
  compare each version) took staleness from **0/3 → 3/3**.
- **Agent-agnostic self-critique** — the shared `selfCritique` prompt was written in the *reviewer's* voice
  ("your review… security findings… VERDICT line"), which derailed the scribe (it started talking about security
  reviews). Rewriting the prompt to be agent-agnostic (re-verify your claims against the files, per your own rules)
  fixed the scribe **and** left the reviewer un-regressed (expert 3/3, 0 false positives). One fix, both agents.

## Caveats
Small fixtures, small N. Groundedness precision is checked mechanically (path existence); prose quality (tone,
structure) is not auto-graded. Summarization fidelity is left to a future suite.

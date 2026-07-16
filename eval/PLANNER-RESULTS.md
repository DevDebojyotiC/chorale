# Planner / Architect — benchmark & results

The `planner` decomposes a complex request into a **grounded, ordered, executable plan** — steps
with dependencies, specialist assignments, layers, and acceptance criteria — then hands it back for
the orchestrator (or a gate) to execute. Because a plan isn't "run", it is graded on **objective,
checkable properties** rather than execution output — the planner's version of execution-grading.

Run:
- `npx tsx eval/planner-selftest.ts` — validate the graders with synthetic inputs (**no model calls**).
- `npx tsx eval/planner-bench.ts ["<provider:model>" …]` — run the live planner and grade its plans.

## What is graded (`eval/planner-fixtures.ts`)
Each fixture is a request paired with a synthetic repo and gold expectations. A produced plan is
scored on four dimensions:

| Dimension | Question | How |
|-----------|----------|-----|
| **Complexity** | Was the plan/no-plan call right? | `assessComplexity(plan)` vs the gold label (Approach B — read from the decomposition, not the raw request) |
| **Completeness** | Are all required architectural layers covered? | fraction of `requiredLayers` present in the plan's steps |
| **Delegation** | Are the right specialists used, none invented? | `requiredAgents` all present **and** no `unknown-agent` from `validatePlan` |
| **Structure** | Is the plan internally sound and grounded? | `validatePlan` clean — acyclic DAG, sane build order, grounded file refs, acceptance criteria present |

A plan **passes** only if all four hold (completeness = 100%).

## Fixtures
| id | goal | gold complexity | required layers | required agents |
|----|------|:---------------:|-----------------|-----------------|
| `fullstack-lib` | build a library management app | complex | schema · api · ui · tests · docs | coder · scribe |
| `add-endpoint` | paginate GET /users + document it | complex | api · docs | coder · scribe |
| `typo-fix` | fix a README heading typo | trivial | docs | scribe |
| `oauth` | add Google OAuth (design decision first) | complex | api · ui · tests | coder |

## The verification layer (the planner's edge)
The graders lean on the same **`validatePlan`** that the runtime enforces at generation time via the
**plan validate-repair loop** (`src/core/plan.ts` + the loop in `runtime.ts`): a planning agent's
output is checked against the real repo — assignments, the dependency DAG, ordering, grounded file
references, and acceptance criteria — and issues are looped back for a bounded fix round. So a plan
that references an invented file, cycles, or reverses build order is corrected before it's surfaced,
not shipped as-is. This is the planner's analog of the coder's verify and the scribe's `groundCheck`.

## Grader self-validation (deterministic, always runnable)
`planner-selftest.ts` proves the graders discriminate — **with no model calls**, so it runs anywhere,
including without provider credentials:
- Every fixture's hand-authored **gold plan passes** all four dimensions.
- Deliberately-broken plans **fail on exactly the broken dimension**: an unknown agent fails
  delegation; a dropped layer drops completeness below 100%; an invented `existing` file or a
  dependency cycle fails structure; a one-step plan against a complex fixture fails complexity.

Regression-protected in `test/planner-bench.test.ts` (part of `npm test`).

## Live results
The live model harness (`planner-bench.ts`) runs the actual planner per goal in a temp copy of the
fixture repo and scores the produced plan. It requires provider credentials; when the model chain is
unavailable it reports "no plan produced" per fixture and the deterministic self-test stands as the
proof of the grading layer. *(Live scorecard to be filled in on a run with credentials.)*

## Notes / caveats
- **`test-writer` is not yet a real agent** (Task 4). Until it ships, test steps are assigned to the
  **coder** (who writes tests today), and the roster/graders reflect that. When `test-writer` lands,
  the persona and fixtures will route test steps to it.
- Small fixture set; graders check *correctness signals* (right plan/no-plan call, all layers covered,
  capable delegation, sound + grounded structure), not subjective plan elegance.

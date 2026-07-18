# Phase 4 — Core Agents

> **Status:** in progress (Tasks 1–4 + the escalate-last system + the contract-first system + free-GLM model providers shipped; Task 5 remaining) · **Branch:** `phase-4` · **Tests:** 359 passing · **Last updated:** 2026-07-18
>
> This is a **living document**. It records what Phase 4 set out to do, everything built so far,
> and — most importantly — *why* each decision was made. It will be revised and finalized when
> Phase 4 is complete and the branch is merged. Where a section describes work still in flight it
> says so explicitly.

---

## 1. What Phase 4 is, and why it exists

Chorale is a model-agnostic, CLI-first, local-first multi-agent system: an orchestrator routes a
request to specialist agents, each specialist is a persona (a Markdown file with frontmatter +
system prompt) bound to a set of tools, and the whole thing runs on cheap/open models by default
with escalation to stronger models only when it pays off.

Phases 0–3 built the spine: the runtime, the provider/fallback chain, the tool system, the coder
agent, the research agent, the orchestrator, sessions, cost accounting, and the document suite.
**Phase 4 is the *capability* phase** — we grow the specialist roster **one agent per task**, and
every agent ships with an **execution-graded benchmark** so its quality is a measured number, not a
vibe.

The ordering is by leverage (see [`ROADMAP.md`](ROADMAP.md)):

1. **Reviewer / Verifier** ✅ — catches what the coder's mechanical checks can't.
2. **Files / Docs specialist** (`scribe`) ✅ — grounded document generation, editing, and conversion.
3. **Planner / Architect** ✅ — decomposes complex requests into a grounded, validated plan; a generalized, composable **gate** framework; wired plan-first into the orchestrator.
4. **Test-writer** ✅ — writes and *runs* tests, graded by **mutation** (tests must pass on correct code and fail on planted bugs).
5. **Productivity** ⏳ — email/calendar/notes via MCP (the Claude-Desktop-replacement pillar).

Phase 4 closes with a larger real-world codebase benchmark. The GUI is **Phase 5**, deliberately
deferred until the agent roster and its APIs are stable.

### The recurring thesis: *compensation lets the cheap, fast model win*

A pattern established with the coder and reconfirmed by every Phase-4 agent: rather than reaching
for a bigger model, we **compensate** a small, fast, ~$0 model with structure — persona rules,
worked few-shot examples, a self-critique pass, and self-learned lessons. Again and again this
lifts the default model (currently `gemma-4-31B`) to match or beat a much slower escalation model
(`gpt-oss-120B`) on our suites, at a fraction of the latency and cost. Phase 4 leans on four
reusable mechanisms:

- **Per-model compensation** — targeted persona rules/checklists that fix a specific model's blind spot.
- **Few-shot** — inject worked examples (`<agent>.examples.md`); showing beats telling for weak models.
- **Self-heal** — a self-critique second pass and/or a runtime smoke-run that repairs its own output.
- **Self-learn** — proven lessons from past repairs, injected proactively so a mistake isn't repeated.

---

## 2. Task 1 — Reviewer ✅

The `reviewer` is a **read-only** code inspector: tools `read`/`ls`/`glob`/`grep` plus optional
`bash` for verification, and **no write tools** — it *flags*, the coder *fixes*. It is delegable, so
the orchestrator can route a review request to it, and it emits severity-tagged findings
(`BLOCKER` / `MAJOR` / `MINOR` / `NIT`) each with a `file:line`, a concrete fix, and a closing
`VERDICT`.

**Why read-only + severity + verdict.** Separating "who finds bugs" from "who fixes them" keeps the
reviewer honest (it can't paper over a problem by editing) and makes its output a clean, structured
artifact another agent or a human can act on. The verdict gives a machine-checkable gate signal.

**Benchmarks and hardening.** The reviewer is graded on planted-defect fixtures (`eval/reviewer-*.ts`):
baseline **recall 5/5 · precision 1/1**, stable over three runs on the ≈$0 model. Then a **difficulty
ramp** of 10 increasingly subtle defects (default-sort gotcha → prototype pollution) exposed
**complementary security blind spots** — the default model missed prototype pollution, the escalation
model missed ReDoS. A general **security vulnerability-class checklist** in the persona lifted the
default model to a **stable 10/10**. Four full suites (precision, multi-defect, polyglot/Python, an
expert security tier) plus the four mechanisms above put the single-pass scorecard at **ramp 10/10 ·
precision 9/9 · multi 8/8 · polyglot 3/3 · expert 3/3** (see [`eval/REVIEWER-SUITES.md`](../eval/REVIEWER-SUITES.md)).

**Production modes.** Three ways the reviewer is actually used:
- **Diff review** — judges a unified diff (`chorale review [--staged] [paths…]`).
- **Multi-file cross-contract review** — reads several files via its tools and reasons across them.
- **The coder review gate** — after the coder's code verifies clean, the reviewer gives a *semantic
  second opinion*; `BLOCKER`/`MAJOR` findings loop back for a fix. This gate is the seed that Task 3
  later generalizes (see §4). Live demo: coder wrote SQL injection → gate caught it → next round caught
  a missing `await` → clean code in two rounds.

---

## 3. Task 2 — Scribe (files & documents) ✅

The `scribe` generates, edits, summarizes, and organizes a project's documents, **grounded strictly
in the real files**. Tools: `read`/`ls`/`glob`/`grep`/`write`/`edit`/`multi_edit`/`move`/`read_doc`/
`write_doc`/`write_sheet`/`convert`/`check_length`/`bash`. Its code-verify loop is off (it's not a
coder) but its doc-verification tick-boxes are on.

This task grew well beyond "write a README." It became the document *platform*, and several of its
most important pieces came from real defects we hit and turned into permanent rules.

### 3.1 Grounding & the verification layer — the scribe's edge

A generic doc generator will happily invent a file path, a function name, or a statistic. The
scribe's differentiator is that it **can't** (or is caught when it tries):

- **`groundCheck` (anti-hallucination)** — after writing docs, every concrete reference is verified
  to exist: **file paths + code symbols + npm scripts**. A backticked `frobnicate()` that's in no
  file, or a `npm run deploy` that isn't a package.json script, is flagged and looped back. It's the
  doc analog of the coder's verify, and it's conservative (0 false positives on real generated docs).
- **Meaning-preservation** — edit tools snapshot each file's original content; any technical fact
  (number, backticked token, URL) present before an edit but gone after is flagged. Crucially it's
  **intent-aware and one-shot**: it nudges once and lets the model keep an *intended* change (a
  version bump) while restoring an *accidental* drop — so it protects proofreading without fighting a
  legitimate update.
- **Design-fidelity** (`checkDesignFidelity`) — when the model authors a bespoke HTML document, every
  distinctive number in the rendered output must exist in the source it read. This is what lets the
  scribe do *presentation polish* without sacrificing the no-fabrication guarantee.

Full capability coverage is benchmark-verified: **22 checks, all green** on the default model
(`eval/scribe-*.ts`, [`eval/SCRIBE-RESULTS.md`](../eval/SCRIBE-RESULTS.md)) — generation, summary/
extraction, edits, staleness+sync, reorganize/naming, grounded Q&A. Graders are self-validated with
no model calls.

### 3.2 Multi-format document I/O

Tools `read_doc` / `write_doc` / `write_sheet` / `convert` let the scribe **read, create, and
convert** real formats — PDF, DOCX, XLSX, PPTX, HTML, CSV/TSV, JSON, and **images via OCR**. The
division of labor is deliberate: **the model authors Markdown or rows; deterministic tools do the
binary I/O.** PDFs render via headless Chrome/Edge for fidelity, with a pure-JS pdfkit fallback;
images OCR via tesseract.js (model-agnostic — works even on a text-only model). Round-trip benchmark:
**gemma 11/11**. Libraries add **0** `npm audit` vulnerabilities (uuid/esbuild pinned via `overrides`).

**Decision — render HTML faithfully, don't flatten it.** An early version converted HTML→PDF by
extracting text first, destroying all layout. We fixed this so an HTML source is rendered *as-is*
(its own CSS wins), which is what makes the design work below meaningful.

### 3.3 Presentation design — three tiers

Beyond correct conversion, the scribe produces *good-looking* documents, scored on a richness
checklist (`eval/scribe-design.ts`):

1. **Professional themes** (`theme: report|docs|minimal`) — deterministic CSS: gradient cover,
   design-token colors, styled tables, callouts, print styles.
2. **Data visualization** (`charts: true`) — numeric Markdown tables become inline CSS bar charts,
   grounded to the real cell values.
3. **Bespoke design mode** — the *model* authors custom HTML/CSS for a specific document (the
   high-ceiling path), but with the fidelity check enforcing no invented data.

`report + charts` scores **8/8**, beating the reference hand-built report (6/8, which lacks print
styles). The positioning made concrete: a generic converter loses to a bespoke design; a bespoke
design isn't grounded; **the scribe does both** — polish *and* a no-fabrication guarantee.

### 3.4 Ten topic design profiles

So a document reads *honestly as its type*, the scribe has **10 topic profiles**
(`src/tools/doc-profiles.ts`): `executive`, `academic`, `legal`, `invoice`, `resume`, `clinical`,
`marketing`, `editorial`, `recipe`, `techdoc`. Each shares one light, print-friendly base (for
consistency across everything the scribe makes) but has its **own palette, typography, and signature
components** — an invoice looks like an invoice (bill-to, right-aligned line items, totals, due
badge), a lab report flags out-of-range values, a contract has hierarchical clause numbering. Demos
live at `docs/scribe-profile-*.html`; a unit test asserts every profile registers, renders light, and
carries its signature component.

### 3.5 Three rules that came from real defects (permanent)

These are the decisions worth remembering, because each was a mistake we made once and then made
*impossible to repeat*:

- **Light & print-friendly by default.** A model (Gemma) once produced a report on a dark background —
  useless for printing. Rule: every document is **white background, dark text** by default; no
  `@media (prefers-color-scheme: dark)` (it flips dark on a dark-mode reader/printer). A dark or other
  scheme is used **only when the user explicitly asks**. Enforced in code (all themes + profiles are
  light) and regression-tested.

- **One consistent page background.** The three "warm" profiles put the *content column* on a cream
  tint while the surrounding page stayed white — a cream rectangle floating on white, visible in the
  PDF margins. Rule: the **overall page background is a single color** (white by default), set on both
  `html` and `body`, so content, surround, and print margins all match. **Components** may be tinted
  (covers, callouts, cards); the page-wide background may not differ from its surround. Enforced and
  tested.

- **Size the document to its topic.** Every profile demo was a flat 4 pages, which is wrong — an
  invoice should be ~1 page, a research paper ~10+. We added **topic-aware length** (`src/tools/
  doc-pages.ts`): `PAGE_TARGETS` gives a sensible default and range per topic (invoice 1, resume 2,
  clinical 3–4, report 4, techdoc 5, legal 6, academic 12, …); `resolvePageTarget(topic, requested?)`
  resolves it, and **a user-stated page count always overrides the default** (`parsePageRequest`
  extracts "5 pages" / "two-page" / "10-page" from plain language). The 10 demos were re-created to
  honor their topic length (invoice→1, resume→2, academic→8), and a new tool **`check_length(path)`**
  renders a document to A4, counts pages, and reports whether it's on target / under / over with
  guidance — making the length rule *enforceable at generation time*, not just documented.

Full details in [`eval/SCRIBE-RESULTS.md`](../eval/SCRIBE-RESULTS.md). These three rules are also saved
to the assistant's long-term memory as standing preferences.

---

## 4. Task 3 — Planner / Architect & the generalized gate framework ✅

Two intertwined deliverables, both shipped: the **planner agent itself**, and a **generalized "gate"
framework** that emerged from designing how the planner plugs in. The sections below record the design
decisions and *why*; §4.6 lists exactly what was built.

### 4.1 What the Planner/Architect is for

The **orchestrator** already plans *reactively*: each turn it decides answer / delegate / decompose,
greedily, with only a `delegate` tool. That's fine for "research X" but there is no **upfront,
whole-task plan**. The Planner/Architect fills that gap — given a complex request it produces an
explicit plan *before* execution: decompose into ordered sub-tasks, express dependencies (a DAG, not
a flat list), assign each step to the right specialist, and attach acceptance criteria. The
"architect" half is the up-front *technical design* (interfaces, data model, trade-offs) that should
precede coding. The orchestrator still routes; the planner designs the route in advance.

Like every Phase-4 agent it must be **benchmarkable** — a plan that's verifiably *complete*, correctly
*ordered*, correctly *delegated*, and *grounded* (references real repo files), not a plausible-looking
bullet list.

### 4.2 The design decisions (and why)

We deliberately worked the design out in conversation before building. The decisions:

**Decision 1 — Option 3: a standalone planner *plus* an orchestrator hook.** We considered three
shapes: (1) a delegable planner the orchestrator *may* call; (2) folding planning into the
orchestrator; (3) both — a standalone planner *and* an automatic hook that guarantees plan-first for
complex requests. We chose **(3)**. The reason: with (1) alone, whether planning happens depends on a
cheap orchestrator model reliably choosing to plan — exactly the judgment a weak model gets wrong on a
big vague ask ("build me a fullstack app" → it delegates one giant under-specified task to the coder,
which flails). The hook makes plan-first **guaranteed** for complex work, mirroring how the reviewer
gate is auto-wired into the coder rather than left to the coder's discretion.

**Decision 2 — Approach B: decompose-then-measure, not classify-the-request.** How do we decide a
request is "complex" enough to plan? Two ways: (A) pre-classify the raw request text with keywords or
a model call, or (B) do a cheap *triage decomposition* and read complexity off the **result**
(≥3 dependent sub-tasks, or ≥2 specialists, or ≥2 architectural layers, or a required design
decision). We chose **B**. Keyword classification is brittle ("build a library app" vs "organize my
library of books"); a model classifier reintroduces the non-determinism we're trying to remove.
Approach B judges the task by what it *actually decomposes into*, and it's directly benchmarkable
(labeled simple/complex requests → measure the plan/no-plan decision's precision & recall).

**Decision 3 — Approach B is what makes the planner reusable by the coder.** A key realization: the
coder has **no `delegate` tool** (specialists are leaf workers, by design, to avoid recursion), so
"the coder reuses the planner" can't mean delegation. It means factoring the decomposition into a
shared core mechanism (like `groundCheck` in `src/core/ground.ts`) that a **coder plan-gate** invokes
in-process — exactly how the reviewer gate works. Approach A (classify the raw user message) doesn't
port to the coder, which only ever sees a pre-scoped task; Approach B (decompose "a task") ports
unchanged. So **Option 3 + Approach B** is precisely the combination that lets the orchestrator hook,
the planner agent, and a coder plan-gate all draw from one benchmarked mechanism.

### 4.3 Generalizing gates (the user's design call)

Rather than hard-code a "reviewer gate" and a "plan gate" into specific agents, we made **gates a
first-class, opt-in, composable capability**: *any agent may run any permitted other agent as a
checking/planning step that feeds back into its own loop.* An agent declares an allow-list of gates in
its frontmatter (the "tick-boxes"), and each gate is either **`auto`** (fires deterministically at a
lifecycle point) or **`on-demand`** (the agent calls a `gate()` tool when it decides it needs one).
The allow-list governs *permission*; the mode governs *triggering*. This subsumes the old hard-coded
reviewer gate as a mere instance, and makes adding a future gate a config edit, not code.

### 4.4 Loop prevention — from blunt depth-1 to ancestor exclusion

The dangerous question: if any agent can gate any agent, what stops
`coder → reviewer → planner → researcher → coder` — a loop? The first guard was **depth-1**: an agent
running *as* a gate had all its own gates disabled. That prevents the loop, but too bluntly — it also
forbids *legitimate* chains (a `planner` gate that wants to consult `researcher`).

The correct invariant, and the one we implemented, is **ancestor exclusion**: *no agent may appear
twice in a single gate chain.* We track the chain of active agents through the recursive calls
(`src/core/gate.ts`); `canRunGate(chain, target)` refuses a target already in the chain (would loop)
and enforces a depth cap as a cost backstop. This **allows arbitrarily deep chains of distinct
agents** while making a loop structurally impossible — the moment a hop would revisit an ancestor,
it's refused.

### 4.5 What happens when a needed gate is refused — "graceful degradation + light upward signal"

Ancestor exclusion raises a real question: in `coder → planner → researcher`, if the researcher needs
to plan (its research is complex) but `planner` is an ancestor, it's refused — *then what?* We resolved
this with a reframe and a two-part mechanism:

- **The reframe:** a gate is a **quality/second-opinion layer, not a capability-provisioning layer.**
  Every agent is already a capable model that can plan/reason on its own; the `planner` gate is a
  *specialist assist*, not the only thing that can plan. So a refused gate never means "can't proceed."
- **Graceful degradation (option 1):** the refused gate returns a clear reason plus "proceed inline"
  guidance; the agent handles the task itself. No deadlock, guaranteed termination, only a mild loss of
  specialist polish on that one deep branch.
- **Light upward signal (light option 2):** the unmet need is **recorded as advisory metadata** and
  bubbles up on `RunResult.unmetGates` (with an info log line), so a caller *can* react but isn't
  *required* to. We chose "light" 2 over full 2 deliberately — full 2 would be a formal return-signal
  protocol with mandatory handling and real control-flow complexity; light 2 gives the visibility
  (nothing is silently dropped) without the machinery.

### 4.6 What's built so far (green) vs. what's left

**Built — Phase A (the gate framework), all tests green:**

- **A.1 — config + recursion guard.** `GateSpec` + a `gates` allow-list on every agent
  (`src/agents/loader.ts`); frontmatter accepts a bare name (⇒ on-demand) or `{agent, mode, when}`.
  Legacy `reviewGate` is translated into an implicit auto reviewer gate, so existing agents are
  unchanged. The review gate now fires *through* this list. (commit `4fe4f60`)
- **A.2a — loop prevention by ancestor exclusion** (`src/core/gate.ts`): `chainWith`, `canRunGate`,
  `withGateChain`, a depth cap. Replaces the blunt depth-1 guard. (commit `13c14e9`)
- **A.2b — generic `runGate` + on-demand `gate()` tool + light-2 signal.** `runGate` runs any
  allow-listed agent as a one-pass, loop-guarded gate; `reviewGateFindings` is now just an instance of
  it. The `gate()` tool (`src/tools/gate-tool.ts`) is allow-list-restricted; refusals degrade
  gracefully and record `unmetGates` that surface on the result. (commit `9e62a24`)

**Built — Phase B (the planner brain), green:**

- **B.1/B.2 — `src/core/plan.ts` + the planner agent.** A canonical `Plan`, a structured `plan` tool
  (preferred output) + a tolerant Markdown fallback parser, `assessComplexity` (Approach B — measured
  from the decomposition), and `validatePlan` (assignments, DAG, ordering, grounding). `agents/planner.md`
  is read-only (grounds the plan; doesn't write). **A live-exposed gap fixed:** the validator was built
  but *not wired* — added a **plan validate-repair loop** in the runtime, so a plan's grounding is
  enforced, not just documented; plus fixes (preserve unresolvable deps so they're flagged; require
  acceptance criteria; don't flag a file an earlier step creates; tighten the design-decision heuristic).
- **B.3 — benchmark** (`eval/planner-*.ts`, `PLANNER-RESULTS.md`): graded on Complexity / Completeness /
  Delegation / Structure. `planner-selftest.ts` proves the graders with **no model calls** (gold plans
  pass; broken plans fail on exactly the broken dimension).

**Built — Phase C (wiring, pure config):** a `pre` lifecycle auto-gate hook; the orchestrator runs the
planner as an **auto `pre` gate** (guaranteed plan-first) and the coder can pull it **on-demand**;
`formatPlan` renders the plan as a checklist injected into the executor.

### 4.7 The fullstack capability experiment (levers #1–#3, #5)

Probing the pipeline on a *real* production-grade fullstack prompt (not the demo) exposed that a cheap
model + per-step delegation builds structured single-domain code well but not a complete, coherent,
runnable multi-domain app. Four compensation levers were built, each deterministic + unit-tested and
each validated against a real failure (full write-up: [`FULLSTACK-EXPERIMENT.md`](FULLSTACK-EXPERIMENT.md)):

- **#1 plan execution across turns** (`src/core/plan-exec.ts`): run *every* step in dependency order,
  delegating each with per-step file verification + retry — the app now *completes* (all layers).
- **#2 shared project contract** (`src/core/contract.ts`): extract the real routes / base URL / tables /
  exports from files built so far and thread them into later steps — so consumers build against reality.
- **#3 runnability gate** (`src/core/runnable.ts`): statically catch no-entry / broken-start / missing-env
  / missing-import / **unmounted-routes**, and loop a repair back to the coder.
- **#5 escalation**: escalate the retry/repair to the stronger model (gpt-oss) only when the cheap one
  already failed a step.

**Milestone:** with all four, Chorale reliably builds a **complete, wired, booting fullstack skeleton whose
backend serves its API**. A *fully working* app is still beyond reliable cheap-model reach; the remaining
gaps (dynamic boot-and-smoke runnability; build ordering so producers are correct before consumers build)
are characterized in the findings doc. All opt-in via `CHORALE_PLAN_EXEC=1` — default behavior unchanged.

## 4b. Task 4 — Test-writer ✅

`test-writer` writes **and runs** tests for existing code, graded by **mutation** — the honest metric:
its tests must **pass on the correct implementation AND fail on every planted buggy mutant**. A
green-but-worthless suite (trivial assertions / matching a bug) is exactly the failure the benchmark
exposes. Persona rule: *never weaken a test to go green* — a test failing because the code is wrong is a
**bug found**, reported, not papered over. Benchmark (`eval/testwriter-*.ts`, `TESTWRITER-RESULTS.md`)
runs `node --test` on real files (execution-grading, no model calls in the self-test): gold suites kill
all mutants; a trivial `assert.ok(true)` suite passes clean but kills nothing → graded not-good. The
planner now routes test steps to it.

---

## 4c. Escalation as a *last resort* — the Playbook + repair ladder ✅

### 4c.1 The thesis

Escalating to a bigger model was, until now, the *immediate* response to a failure. That is the wrong
instinct — and the analogy that drove this design: **if a junior developer is stuck, you don't hand the
task to a senior. You give the junior the runbook, the research, and a debugging method — and only if
all of that is exhausted do you escalate, and then you escalate *with everything already learned*.**

Small models often lack **know-how**, not capability. Given tools, accumulated fixes, and a method, they
solve problems a bigger model would. So: **escalation is the last rung, not the first response** — and
every fix found along the way becomes permanent, shared know-how.

This distinction is load-bearing, and the runs proved both halves of it:

- **Know-how gap** — the model doesn't *know* the fix. Recall/research fixes it cheaply.
- **Capability / instruction-following gap** — the model is handed the *exact* fix and still doesn't
  execute it (it explains instead of writing the file). Research doesn't help; more context doesn't
  help. This needed its own mechanism (§4c.5).

### 4c.2 The Playbook (`src/core/playbook.ts`)

A persistent, self-growing knowledge base of *{issue → verified fix}*, plus a per-model capability
profile. Entries record the **whole episode**, not a one-line hint: symptom, root cause, the solution
that verifiably worked, **the dead ends already tried**, and context.

Two design ideas make it intelligent rather than a scoreboard:

**Intelligent trust — trust the *fix*, not the applier.** A naive `wins/uses` ratio is wrong: if an
issue was met 3× and solved once, the two misses may be *the model's* limitation, not a bad fix. So a
failure only counts against a fix when it was a **fair test** — the escalated attempt failed *with the
fix in hand*, or a model already **proven capable** of that class still failed. Weak-model-at-thin-
context failures are attributed to capability and ignored. Verdicts: `trusted` / `unproven`
(capability-limited — explicitly *not* the fix's fault) / `suspect` (a fair test failed → the fix is
probably wrong, and `recall()` stops offering it).

**Capability profile — per model, per issue-class.** Every attempt logs a `SolveEvent`
(model, issue-class, context level, outcome, project, step). From the log we derive, for each model and
class: success at each context level, the **cheapest level it succeeds at**, and a **gap** (tried hard —
research/escalated — and never solved → beyond this model, route elsewhere). The two systems feed each
other: the capability profile is exactly what tells the trust score whether a failure was fair.

*Decision — score each attempt under the model that actually ran it.* The escalate rung is a
**different** model. Initially every rung was logged under the cheap model, which both **falsely
credited the junior with the senior's win** and left the strong model with no profile at all. Fixed:
the escalated attempt is scored under `escalateModel`.

*Decision — the store is global, pinned to the launch directory.* It is cross-project know-how by
definition. The default relative path resolved against the *build* cwd (the runner `chdir`s into the
generated project), which silently scattered a separate playbook into every generated app. Now pinned
to the launch dir at module load, before any `chdir`.

### 4c.3 The repair ladder (`src/core/repair.ts`)

When a gate flags a failure, climb — verifying after every rung, escalating only when the cheap rungs
are exhausted:

| Rung | What it does |
|---|---|
| **playbook** | recall verified fixes for this issue-class + `diagnose()` hints + a **debugging method** (reproduce → localize → hypothesize → smallest fix → confirm); cheap model retries |
| **research** | known fixes didn't take → **delegate to the `research` agent** for real, feed its findings to the coder, carrying forward what already failed |
| **escalate** | LAST resort — the stronger model, handed *everything already tried* so it doesn't restart |

Capability-aware shortcuts: **start high** on a proven gap (skip the cheap rungs when there's nothing
new to inject), and **bail early** — if a *trusted* fix was handed over and still didn't take, that's a
capability gap, not a knowledge gap, so skip research and escalate. But **new information wins**: a
freshly-recalled fix *always* earns the cheap rung, even if the profile historically wanted a higher one
(the playbook has since grown — the old verdict is stale).

**Write-back closes the loop.** A win from research/escalate is recorded as a new entry — so the next
time that class appears, the *cheap* model gets the senior's fix injected and solves it at rung 0. A win
at the playbook rung mints nothing (the fix was already there); it just bumps that entry's trust.

### 4c.4 Never cold — seeding (`src/core/playbook-seed.ts`)

A knowledge base that starts empty is useless on the failure that matters most: the first one. The
hand-written `diagnose.ts` registry already encodes fixes for our most common error classes, so those
are **seeded as entries on first use** (idempotent), alongside explicit seeds for every **runnability**
class (missing entry point, broken start script, unmounted routers, missing `.env`, frontend/backend
mismatch, dangling import, unresolvable dependency version). 16 fixes, so the very first occurrence of a
known class already has a concrete, verified fix to recall.

### 4c.5 What the live stress tests actually taught us

Three production-grade fullstack builds (LedgerLite · InventoryIQ · TaskFlow), each run end-to-end.
Every one found a *different* defect — and almost none of them were in the ladder itself:

- **Repair the foundation first, in isolation.** A build with no server entry produces a *cascade*: the
  missing entry is *why* the routers are unmounted. Handing the coder all 7 symptoms at once buried the
  one fix that mattered — even gpt-oss failed. **Tiered repair** (`tiersOf`) fixes foundational issues
  (`no-entry`/`broken-start`) alone, and the downstream tier collapses on its own. This flipped the
  outcome: what escalation couldn't fix became a **cheap-rung** fix.
- **Concrete directives beat "fix it".** `foundationalDirective` (create/replace ONE entry, mount *these
  named* routers, fix the start script), `contractDirective` (the backend serves *these* endpoints, the
  frontend calls *these* — align it, here's the client file), `missingImportDirective` (per import:
  point at the real file, or create it).
- **The no-op-write guard — the single highest-value fix.** The coder frequently *explained* the fix
  instead of writing it, and the ladder silently climbed. Now a rung whose attempt leaves the project
  **byte-for-byte unchanged** is detected as a no-op and force-retried write-only. It fired at the
  playbook rung *and* on gpt-oss, repeatedly converting a silent failure into a real fix.
- **Placeholder stubs.** The coder scaffolds `// implementation will follow in subsequent steps` and
  never returns. `findStubEntry` detects it so the directive says **replace** it, not "create" one.
- **A check that can't be satisfied is worse than no check.** The frontend/backend contract check
  false-flagged *correct* code: it couldn't resolve `${BASE_URL}` template constants, and it only
  scanned files literally containing `axios`/`fetch` — missing every `api.post(...)` call in page files
  of a modern centralized-client SPA. The ladder burned playbook→research→**escalate** against a check
  that could never pass. Now it resolves string constants and traces the `axios.create` instance across
  the app.
- **Never fail a build over a cosmetic field.** `PLAN_TOOL_SCHEMA` required `summary`. A planner that
  emitted `{steps:[…]}` without it had **every** tool call rejected before `execute()` ran → no plan
  captured → plan-exec skipped → **an entire production build silently produced nothing** (12 wasted
  plan calls, ~6 min, zero output). `normalizePlan` already defaulted the field, so the strictness
  bought nothing. Now optional — and the same build then reached `✓ plan valid` on the first call.
- **Boot honestly, and don't repair a non-bug.** The boot gate needs the backend's dependencies, so it
  now installs them (`ensureServerDeps`) — and it must never claim "server starts and serves" when it
  actually skipped. A failed install is only handed to the ladder when npm genuinely **cannot resolve** a
  dependency (a hallucinated version — a real code bug); a **timeout** or toolchain failure is reported
  as inconclusive, because telling the coder to "fix package.json" when the versions are fine sends both
  models chasing a bug that doesn't exist. npm's real stderr is now captured (`npmError`) so the repair
  names the actual bad package instead of "Command failed".

**Milestone (TaskFlow):** a fresh production-grade build reached **`✓ runnable (all tiers cleared)`
inside the pipeline itself**, wrote a fix **back to the playbook in-run**, and drove the boot gate for
the first time. Most tiers cleared at the **cheap** rung; escalation was reserved for the genuinely hard
cross-module edit.

### 4c.6 Chasing the moving frontier — two classes the gates couldn't see

"Runnable" was not the same as "correct". Two defects sat *below* every gate — the app booted and
served perfectly, so nothing caught them — and both were found by hand in the stress builds before
being made into checks:

- **`missing-endpoint`** — the contract check only fired when the frontend matched **nothing** (a wrong
  base URL). A *partial* gap slipped straight through: LedgerLite's frontend called
  `/api/auth/refresh` while the backend only ever defined `/login` + `/register`. The base was right,
  so the check stayed silent — and the route simply 404s at runtime. Now, when the base *does* match,
  each called path the backend never defines is flagged, and the directive steers the fix to the
  **backend** (the frontend is expressing the required spec). Guarded against the obvious false
  positive: a call is only considered if it shares a top-level segment with a real route, so a
  third-party URL (`https://api.stripe.com/v1/charges`) is never mistaken for a missing route.
- **`unrunnable-entry`** — InventoryIQ shipped a `.js` entry importing `.ts` route files with
  `"start": "node src/index.js"`. **node cannot execute TypeScript**, so the app could never start —
  yet every static check passed. Now flagged as **foundational** (tier 0: a start command that can't
  run its own entry makes everything else moot), with the fix framed as a choice: plain JS, or a build
  step (`tsc` → `node dist/index.js`), or a loader (`tsx`). Guarded: a start script using a
  loader/transpiler, or pointing at compiled output, is correctly left alone.

Both are seeded, and directive selection is centralized in `directiveFor` so the runtime and the eval
harness cannot drift apart. Re-running the new checks over the three stress builds caught **exactly**
the two hand-found defects and nothing else (TaskFlow: 0 issues) — which also corrects the record: the
earlier "runnable" verdicts on LedgerLite and InventoryIQ were incomplete.

**`unexposed-feature` — dead feature layers (the deepest gap).** BookIt booted, its mounted routes
worked, yet whole implemented features (an auth repo, a bookings service) were **dead code**: no route
file was ever written to expose them, so `unmounted-routes` — which needs a router *file* to flag —
couldn't see them. The check is **reachability-based**: from each backend unit's real entry points (the
`.listen` file plus any `package.json` script/`main` target — a service wired only to a worker or seed
is *not* dead), walk the local-import graph (static, dynamic `import()`, and CJS `require`, through
barrel index files); any repository/service/controller module nothing reachable imports is flagged, in
one grouped issue, with a directive that names each dead module, its exports, the exact app file that
must mount it, and any route file that *already exists and only needs wiring in*.

This check was **adversarially verified by a multi-agent workflow** (three lenses: algorithm review,
an executing false-positive hunt, a test-gap critic) before shipping — a false positive here would make
the ladder escalate against a check that can never pass, the failure that had already cost three earlier
runs. It surfaced **17 execution-confirmed defects**, all fixed and pinned with regression tests:
unresolvable `index.mjs`/`index.cjs` barrels; e2e tests that call `app.listen` masking every dead
feature by counting as roots; `./x.ts` resolving to a stale `.js` sibling; package-less static
frontends (`public/`) judged by backend rules; `.d.ts` files treated as features; `require (` with a
space; commented-out wiring counted as live; path-alias imports (`@/…`) rendering a unit inconclusive;
and a refined "zero reachable ⇒ inconclusive" guard that still flags a lone dead feature in a working
graph. Validated end to end on BookIt: the check flagged five dead modules; once wired (auth + booking
routes mounted) the build reached **0 issues and served register/login/bookings for real** — and the
wiring **surfaced three bugs the dead code had hidden** (a `JWT_SECRET`/`JWT_ACCESS_SECRET` name
mismatch, dotenv loading after the module that read it, a phantom `../db.js` import). Dead code hides
bugs; exposing it is what finds them.

**Deterministic wire-up — code where the model keeps failing.** Detecting the gap wasn't enough:
across three repair passes, gemma *and* gpt-oss reliably wrote a route file and then failed to make the
coordinated edit to mount it in the app file (a multi-file edit the models botch even when the directive
names the exact file and lines). But mounting an existing router is *mechanical*, so `planWireUp` does
it as a pure transform — walk the app file's import graph, find every router file it doesn't already
reach, and splice in the `import` + `app.use(...)` (mirroring the app's extension, quote, and
prefix/bare mount style, placed after the import block and before the 404/error catch-all). It runs as a
**pre-pass** before the model on any `unmounted-routes`/`unexposed-feature` tier: the tier often clears
with **zero model calls**, and the model is left only with routes that genuinely need to be *generated*.
Verified end to end — an unmounted-router fixture wires up deterministically to **0 issues and boots +
serves the newly-mounted route** — and mirrors the `.js`-specifier/`.ts`-file convention so the edit
survives `tsc`.

**Scaffold the missing route too.** Wire-up mounts routers that *exist*; when the route file itself was
never written, `scaffoldRoutes` generates one from a template: parse the dead module's class + public
methods, and emit a real router that imports it and maps each method to a REST endpoint — verb and path
inferred from the method name (`create*`→`POST /`, `cancel*`→`DELETE /:id`, a plural `get*`→`GET /`
collection vs singular→`GET /:id`), arguments mapped from `req.body`/`req.params`/`req.query` **by
parameter name**, static vs instance calls handled, `.js`-specifier convention preserved. Only
top-level dead modules get a route (a repo imported by a dead service is exposed transitively). The two
run as a combined pre-pass — **scaffold → wire-up → re-check** — so an `unmounted-routes`/
`unexposed-feature` tier often clears with **zero model calls**, leaving the model only truly novel
generation. Proven end to end: a dead `NoteService` with no route went **scaffold → mount → boot →
`POST /` created a note (`201`) and `GET /` listed it (`200`)** — the transform produced a *working*
router, not just a valid-looking one. This is the pattern the whole phase keeps arriving at:
**deterministic transforms for the mechanical, the model only for genuine generation.**

That guard also got sharper here: "all features dead" is only suppressed when the walk resolved *no*
edges (a broken/empty graph) or when the reachable code **loads routes dynamically** (`readdirSync` +
`import`, or a non-literal `require`) — the one case a static graph genuinely cannot see. A working
graph whose reachable code simply never touches the feature layer is a real, actionable gap, flagged.

**The maximal stress run (OpsHub) found two more, both real.** A ~10-feature app (auth, projects, a task
state machine, comments, multipart attachments, FTS5 search, an atomic claim transaction, timezone
analytics, WebSocket real-time) — an **18-step plan, captured first try** (token-cap fix holding at the
largest scale). It surfaced two detection bugs, now fixed and regression-tested: (1) route-file
detection was **path-based** (`routes/` dir or `*.routes.*` name), so a **modular layout**
(`modules/<feature>/routes.ts`) was invisible to wire-up/scaffold even though the `unmounted-routes`
*check* (content-based) saw it — detection is now **by content everywhere** (builds + exports a router),
with the variable name taken from the folder for generic `routes` basenames; and (2) `resolveTail`
derived the importing file's directory via `moduleKey`, which strips `/index` — so an entry named
`index.ts` (the most common name) resolved every relative import one directory too high, making **every
router it mounted look unmounted**. With both fixed, OpsHub's deterministic wire-up mounts all six
modular routers and the build reaches **0 runnability issues**. (The boot gate couldn't run here —
`better-sqlite3`'s native module won't compile in this environment — and the classifier correctly
reported that as *inconclusive*, not a repairable bug, exactly as intended.) Each stress build has found
exactly one-or-two new failure classes, every one a real defect turned into a check + a test.

**Two more, from actually trying to boot OpsHub past the native wall.** (1) The boot gate's install
failure was a **stale native module** — `better-sqlite3@^9` has no prebuilt binary for Node 22, so
`node-gyp` tried to compile it and failed for want of a C++ toolchain (`gyp ERR! find VS`). That is not
an environment wall: bumping to `^12` installs a prebuild in seconds, no compiler. So it's now a
*repairable* class — `classifyInstallError` recognizes the `native-build` signature, **names the
module**, and the ladder is told to bump it to a current major (or switch to build-free `node:sqlite`),
never to add a toolchain. (2) With deps installing, the boot revealed `jsonwebtoken`, `zod`, and `ws`
were **imported but declared in no `package.json`** — so `npm install` never fetched them and the app
died on load. This is the npm-package analog of `missing-import`, now its own check:
**`missing-dependency`** collects every bare import, drops Node builtins (`node:`-prefixed and the real
`builtinModules` set), path aliases (`@/`, `~/`, `#`, and tsconfig `paths`), and specifiers that
resolve to a local file (baseUrl), then flags any package **no** `package.json` declares (lenient, so
monorepo hoisting never false-flags). Run over the five builds it found real misses in three
(`cors`/`helmet`/`express-rate-limit`/`@jest/globals`; `ws` in both real-time apps — the very reason
their WebSockets couldn't work) and **zero false positives** on the two that were clean. Both classes
carry a diagnose entry + seed so the boot ladder recalls them, and the coder persona now pins native
modules to a current major.

**Honest limits.** A *fully working* app from one cheap-model run remains out of reach, and the frontier
keeps *moving* — every fix reveals the next class, and each of these checks is a heuristic that can only
see what it models (nothing here verifies business logic, auth correctness, or data integrity). What is
now true: the pipeline reliably takes a real build to **runnable**, mostly at the cheap rung, and
**remembers** how.

### 4c.7 Seeing it — `chorale playbook`

Both score types are inspectable: every fix with its trust verdict/score, and the per-model capability
profile by issue-class (`playbook 0/1  research 0/1 → ⚠ GAP → escalate this class`). Trust and
capability are **derived on read** from the recorded attempts, so the view always reflects reality.
The store lives at `data/playbook.json` (gitignored, like `lessons.sqlite`); override with
`CHORALE_PLAYBOOK_DB`.

### 4c.8 New env flags

| Flag | Effect |
|---|---|
| `CHORALE_NO_LADDER=1` | disable the repair ladder (gates still report) |
| `CHORALE_BOOT_INSTALL=0` | don't install backend deps before the boot gate |
| `CHORALE_BOOT_CONTAINER=1` | install deps inside a node:22 toolchain container (opt-in; needs Docker) |
| `CHORALE_PLAYBOOK_DB` | override the playbook store path |

---

## 4d. Contract-first — deciding the seams before writing the code ✅

### 4d.1 The thesis
The gates and the moving frontier (§4c.6) chase *symptoms*: an unmounted router, an undeclared package,
a frontend calling the wrong path. The **cause** is upstream — every file is generated in isolation, so
there is no shared source of truth for the *seams between them*, and the two sides of each seam guess at
each other. Contract-first flips it: the planner decides the interfaces **once, up front**, and that
contract is threaded into every step and enforced deterministically. Five levers, in leverage order.

### 4d.2 Lever #1 — the up-front interface contract (`src/core/design-contract.ts`)
The `plan` tool now carries a `contract`: exact endpoints (method + full path + shapes), each shared
module's exports/signatures, the data model, the full dependency list, and env vars. It rides on
`Plan.contract` (optional — a plan without one still runs) and is injected **verbatim into every
plan-exec step** as *"the single source of truth; build to match it exactly"*, alongside the existing
reactive contract (what's been built so far). Producers and consumers now reference one spec.

### 4d.3 Lever #2 — the deterministic skeleton (`src/core/skeleton.ts` + `dependency-registry.ts`)
Contract-first only pays off if the mechanical files the model botches are made correct with **no model
call**. `planSkeleton()` guarantees, against the contract *and* the code actually written: every
imported/contract package is declared in a `package.json` with a **resolvable** version range (a curated
table pins native modules to a prebuild-shipping major; unknowns fall back to `latest`), with
monorepo-correct per-unit attribution, and every contract env var is in a root `.env`. Only completes
what's missing — never narrows or overwrites. `runnable.ts` exposes `importedPackages()` so the skeleton
and the missing-dependency check share one definition of "what is a package". *Verified on real apps: it
deterministically declares `ws` (opshub/taskflow — the exact WebSocket boot blocker) and
`cors`/`helmet`/`express-rate-limit` (inventoryiq), zero edits on the clean ones.*

### 4d.4 Lever #3 — deterministic bookkeeping repair
The bookkeeping issue classes are fixed in code, no model call: **missing-dependency / missing-env** via
the skeleton (above), and the **start-script class** via `repairStartScripts()` — a start script that
runs TypeScript through plain `node` (the `unrunnable-entry` class), or a broken `node <missing.js>`
whose `.ts` source exists, is rewritten to `tsx`, ensuring the tsx/typescript devDeps; compiled-output
(`dist/`) starts and already-loadered scripts are left alone. (We deliberately do *not* auto-stub
`missing-endpoint`: a stub trades a missing endpoint for one that returns nothing real.)

### 4d.5 Lever #4 — per-step contract-drift verification
Verifying only at the end lets a boundary break compound. `contractDrift()` checks each step's served
endpoints against the contract the moment it finishes: a same-method, same-resource, **wrong-prefix**
near-miss (`/login` vs `/api/auth/login` — one path a slash-anchored suffix of the other) is drift and
the step is re-attempted with the exact expected path. Exact matches, genuinely-new endpoints (a health
check), and two paths that merely share a last word (`/admin/users` vs `/api/users`) are left alone.

### 4d.6 Lever #5 — boot through the real runner + probe the contract (`src/core/smoke-run.ts`)
The boot gate hardcoded `node <entry>`, so **every** TypeScript backend spuriously failed it.
`bootLaunch()` now respects the unit's start script (tsx / ts-node / node), forces a loader when a script
would run TypeScript through plain node, and infers from the entry extension otherwise — booting through
the unit-local `tsx` bin. Probing was root-only; it now exercises the whole GET read-surface of the
contract (reads are side-effect-free) and merges the designed contract's endpoints, so a 5xx anywhere in
the agreed API is caught. An opt-in toolchain container (`CHORALE_BOOT_CONTAINER=1`) installs inside
`node:22-bookworm` so a native module with no prebuild still compiles, degrading to a local install when
Docker is unreachable. *Live-verified (no API cost): bookit boots through tsx — the old path ran
`node index.js` and crashed on its TS imports — and full-surface probing caught a `GET /slots` 500 the
base-only probe missed.*

---

## 4e. Free GLM model providers — replacing gemma ✅

### 4e.1 Why
The default heavy tier was `hf:google/gemma-4-31B-it`, but with no HF token configured it silently fell
back to the paid `gpt-oss-120B` on every call. The goal: a genuinely **free**, capable default. Two
routes to free GLM (Zhipu/Z.ai's models) were added; both slot into the model registry.

### 4e.2 Z.ai direct — pure config (`zai` provider)
Z.ai's own API is OpenAI-compatible, so it needs **no code** — a provider on the existing
`openai-compatible` path. The live-verified base URL is **`https://api.z.ai/api/paas/v4`** (the
documented `/api/openai/v1` 404s for a standard key). Free models: `glm-4.5-flash` / `glm-4.7-flash`.

### 4e.3 Puter — a custom shim (`puter` provider, `src/core/puter-provider.ts`)
Puter fronts the *whole* GLM lineup for free, but exposes AI **only** through the `puter.ai.chat` JS
function (no REST endpoint). Since that call is itself OpenAI-Chat-shaped (messages+roles, `tools`,
`tool_calls`), the provider reuses the openai-compatible model with a **custom `fetch`** that routes
`/chat/completions` through `puter.ai.chat` and re-wraps the reply in the OpenAI envelope — no bespoke
AI-SDK model. Two real Node bugs were found and fixed live: puter.js opens a realtime **WebSocket that
crashes on close in undici** ("Maximum call stack size exceeded") → a tightly-scoped, lazy guard swallows
only that noise; and puter rejects with a **plain object** (not an `Error`) → surface `.message`/`.code`
so failures like `insufficient_funds` are legible. Auth is a browser-login token (`getAuthToken()`).

### 4e.4 Live validation
Text **and multi-step tool calling** (chorale's critical path) verified through the real SDK → shim on
`zai:glm-4.5-flash`, `puter:z-ai/glm-4.6`, and `puter:z-ai/glm-5.2`. Working Puter GLM IDs: glm-4.6,
glm-5.2, glm-5.1, glm-4.5-air, deepseek-chat; **glm-4.7 and glm-5 error out**.

### 4e.5 What the live builds taught us (honest limits)
- **`glm-4.5-flash` is too weak for the structured planner** — it emitted an unrepairable **cyclic
  plan**, so the whole contract-first pipeline was bypassed and the build collapsed to one direct
  delegation that produced an empty shell (config + test stubs, no server).
- **`glm-4.6` is a capable workhorse** — a valid 9-step plan, 8/9 steps, a real full-structure app
  (backend + auth + JWT + DB + frontend + tests + docs); the contract-first skeleton fired (added `.env`
  + a dep). But it **did not finish booting** because of the next point.
- **Puter's "free unlimited" is a 25M-unit MONTHLY allowance** (`GET /metering/usage` →
  `allowanceInfo`). **One glm-4.6 build consumed ~24.7M (~99%)** — i.e. **≈ one build per month**, and it
  exhausted mid-repair (`insufficient_funds`), which is why the build never reached a clean boot.

### 4e.6 Decision (the current default)
Free-and-capable-and-sustained isn't available, so the chain leads with reliability and keeps GLM as an
opportunistic free fallback (usable again after Puter's monthly reset):
**`fireworks:gpt-oss-120b` (default) → `puter:z-ai/glm-4.6` → `zai:glm-4.5-flash` → `ollama:qwen3:4b`**,
across all seven agents. Fireworks-primary also means normal calls never waste a failed Puter attempt.
See the memory note *puter-free-tier* for the economics.

---

## 5. Current state at a glance

| Item | State |
|------|-------|
| Branch | `phase-4` |
| Tests | **359 passing**, typecheck clean, `npm audit` 0 vulnerabilities |
| Task 1 — Reviewer | ✅ shipped (5 suites green, 3 production modes) |
| Task 2 — Scribe | ✅ shipped (22 capability checks green, multi-format I/O, 3 design tiers, 10 profiles, 3 permanent doc rules, `check_length`) |
| Task 3 — Planner/Gates | ✅ shipped — planner agent + `plan.ts` (validate-repair), generalized gates (ancestor-exclusion loop guard, on-demand + auto), benchmark, plan-first wiring |
| Task 4 — Test-writer | ✅ shipped — writes+runs tests, mutation-graded |
| Fullstack levers | ✅ #1 plan-exec · #2 shared contract · #3 runnability gate · #5 escalation (opt-in `CHORALE_PLAN_EXEC`) |
| Escalate-last system | ✅ shipped — Playbook (intelligent trust + per-model capability), repair ladder (recall → research → escalate, write-back), 18 seeded fixes, tiered foundational repair, no-op-write guard, dynamic boot gate w/ dep install, `unrunnable-entry` + `missing-endpoint` checks, `chorale playbook` |
| Contract-first (§4d) | ✅ shipped — up-front interface contract, deterministic skeleton + start-script repair, per-step drift check, real-runner boot + full-contract probe (`CHORALE_NO_CONTRACT` A/B switch) |
| Free-GLM providers (§4e) | ✅ shipped — `zai` (OpenAI-compatible) + `puter` (custom shim over `puter.ai.chat`); text + tool calling live-verified; Puter free = ~1 build/month |
| Task 5 — Productivity | ⏳ not started — email / calendar / notes via MCP (the Claude-Desktop-replacement pillar) |
| Default model | `fireworks:…/gpt-oss-120b` (reliable) · fallback `puter:z-ai/glm-4.6` (free, ~1 build/mo) → `zai:glm-4.5-flash` → `ollama:qwen3:4b` |

### Key modules touched this phase
- `agents/*.md` — reviewer/scribe/planner/test-writer personas + examples; `gates` allow-lists.
- `src/agents/loader.ts` — `GateSpec` + `gates` parsing (+ legacy `reviewGate` translation).
- `src/core/ground.ts` — `groundCheck`, meaning-preservation, `checkDesignFidelity`.
- `src/core/gate.ts` — gate chain, ancestor-exclusion loop guard, depth cap.
- `src/core/plan.ts` / `plan-exec.ts` — plan model + validate-repair; deterministic plan execution.
- `src/core/contract.ts` / `runnable.ts` — shared-contract extraction; runnability gate (incl.
  `unrunnable-entry` + `missing-endpoint`); repair **tiers** (`tiersOf`) + the concrete directives,
  dispatched by `directiveFor`; `findStubEntry`; centralized-client contract tracing.
- `src/core/playbook.ts` / `playbook-seed.ts` — the growing knowledge base: rich entries, deterministic
  recall, intelligent trust (fair-failure attribution), per-model capability + gap detection; 16 seeds.
- `src/core/repair.ts` — the repair ladder (recall → research → escalate), capability shortcuts,
  no-op-write guard, verified write-back.
- `src/core/smoke-run.ts` — dynamic boot gate; `ensureServerDeps` (install + failure classification),
  `npmError`; contract-first: `bootLaunch` (real tsx/ts-node/node runner), full-contract probing,
  `containerInstallArgs`/`dockerAvailable` (opt-in toolchain container).
- `src/core/design-contract.ts` — the up-front interface contract (§4d): `DesignContract`, formatting,
  and `contractDrift`/`driftDirective` (per-step drift check).
- `src/core/skeleton.ts` / `dependency-registry.ts` — deterministic skeleton (§4d): `planSkeleton`
  (package.json + .env reconciliation) and `repairStartScripts`; curated version ranges.
- `src/core/puter-provider.ts` — free-GLM Puter provider (§4e): OpenAI-envelope shim over
  `puter.ai.chat`, WebSocket-crash guard, legible error surfacing.
- `src/core/model-registry.ts` / `config.ts` — `puter` provider type; `zai` + `puter` providers.
- `src/core/runtime.ts` — `runGate`, gates, `RunResult.{unmetGates,plan}`, plan-exec + #2/#3/#5 wiring,
  tiered runnability repair + boot gate wired to the ladder; contract-first threading + deterministic
  pre-passes; `CHORALE_NO_CONTRACT` A/B switch.
- `src/index.ts` — `chorale playbook` (fix trust + per-model capability view).
- `src/tools/gate-tool.ts` / `plan-tool.ts` — the `gate()` and `plan` tools.
- `src/tools/documents.ts` — `read_doc`/`write_doc`/`write_sheet`/`convert`/`check_length`.
- `src/tools/doc-themes.ts`, `doc-profiles.ts`, `doc-pages.ts` — themes, 10 profiles, topic-length.

---

## 6. Concept glossary

- **Agent** — a persona (`agents/<name>.md`: frontmatter + system prompt) bound to a tool allow-list.
- **Delegate** — the orchestrator hands a *whole self-contained sub-task* to a specialist. One-way,
  cycle-guarded by the delegation path. Only the orchestrator has it.
- **Gate** — an agent runs a *permitted other agent* as an **advisory** checking/planning step whose
  result feeds back into its **own** loop. Allow-listed, loop-guarded by ancestor exclusion. Different
  from delegate (which hands off ownership). Modes: `auto` (lifecycle) / `on-demand` (`gate()` tool).
- **Gate chain / ancestor exclusion** — the list of agents active in a gate lineage; no agent may
  appear twice, so loops are impossible while distinct-agent chains are allowed.
- **Graceful degradation + light-2 signal** — a refused gate returns "proceed inline" guidance and
  records an unmet-gate note (`RunResult.unmetGates`) rather than deadlocking or silently dropping the
  need.
- **`groundCheck` / meaning-preservation / design-fidelity** — the scribe's three anti-hallucination
  checks (references exist / facts preserved across edits / no invented numbers in bespoke HTML).
- **Compensation mechanisms** — per-model rules, few-shot, self-heal (self-critique), self-learn:
  structure that lets the cheap default model match a costlier one.
- **Playbook** — the growing, cross-project knowledge base of *{issue → verified fix}* (whole episodes:
  symptom, root cause, the fix that worked, the dead ends), plus the per-model capability profile.
- **Repair ladder** — recall → research → **escalate last**, verifying after each rung; a win from
  research/escalate is written back so the cheap model inherits it next time.
- **Intelligent trust** — a fix's trust is only lowered by a *fair* test (the escalated attempt failed
  with the fix in hand, or a proven-capable model failed). Weak-model-at-thin-context failures are
  attributed to capability, not the fix.
- **Capability gap** — a model that tried hard (research/escalated) on an issue-class and never solved
  it → route past the cheap rungs. Distinct from a **know-how gap**, which recall/research fixes.
- **No-op-write guard** — a repair attempt that leaves the project byte-for-byte unchanged (the model
  explained instead of writing) is detected and force-retried write-only.
- **Tiered repair** — fix foundational issues (a missing server entry) alone and first; the downstream
  cascade (unmounted routers, etc.) collapses once the foundation exists.
- **Topic-aware length** — per-topic default page targets with a user override, plus `check_length`
  to verify a rendered document against its target.

---

## 7. Related documents

- [`ROADMAP.md`](ROADMAP.md) — phase ordering and rationale.
- [`PHASES.md`](PHASES.md) — the running phase history (this doc expands the Phase 4 entry).
- [`PROJECT-STATE.md`](PROJECT-STATE.md) — current capabilities snapshot.
- [`eval/SCRIBE-RESULTS.md`](../eval/SCRIBE-RESULTS.md) — scribe's full capability matrix.
- [`eval/REVIEWER-SUITES.md`](../eval/REVIEWER-SUITES.md) — reviewer's benchmark suites.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the system's high-level architecture.

---

*This document will be finalized when Phase 4 completes (Tasks 3–5 done, larger real-world benchmark
run) and the `phase-4` branch is prepared for merge.*

# Phase 4 — Core Agents

> **Status:** in progress (Tasks 1–4 + the escalate-last system shipped; Task 5 remaining) · **Branch:** `phase-4` · **Tests:** 264 passing · **Last updated:** 2026-07-17
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
| `CHORALE_PLAYBOOK_DB` | override the playbook store path |

---

## 5. Current state at a glance

| Item | State |
|------|-------|
| Branch | `phase-4` |
| Tests | **264 passing**, typecheck clean, `npm audit` 0 vulnerabilities |
| Task 1 — Reviewer | ✅ shipped (5 suites green, 3 production modes) |
| Task 2 — Scribe | ✅ shipped (22 capability checks green, multi-format I/O, 3 design tiers, 10 profiles, 3 permanent doc rules, `check_length`) |
| Task 3 — Planner/Gates | ✅ shipped — planner agent + `plan.ts` (validate-repair), generalized gates (ancestor-exclusion loop guard, on-demand + auto), benchmark, plan-first wiring |
| Task 4 — Test-writer | ✅ shipped — writes+runs tests, mutation-graded |
| Fullstack levers | ✅ #1 plan-exec · #2 shared contract · #3 runnability gate · #5 escalation (opt-in `CHORALE_PLAN_EXEC`) |
| Escalate-last system | ✅ shipped — Playbook (intelligent trust + per-model capability), repair ladder (recall → research → escalate, write-back), 18 seeded fixes, tiered foundational repair, no-op-write guard, dynamic boot gate w/ dep install, `unrunnable-entry` + `missing-endpoint` checks, `chorale playbook` |
| Task 5 — Productivity | ⏳ not started |
| Default model | `hf:google/gemma-4-31B-it` (≈$0) · escalation `fireworks:…/gpt-oss-120b` |

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
  `npmError`.
- `src/core/runtime.ts` — `runGate`, gates, `RunResult.{unmetGates,plan}`, plan-exec + #2/#3/#5 wiring,
  tiered runnability repair + boot gate wired to the ladder.
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

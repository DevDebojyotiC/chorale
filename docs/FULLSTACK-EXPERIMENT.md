# Fullstack capability experiment — findings

**Date:** 2026-07-16 · **Branch:** `phase-4` · **Artifacts:** `experiments/fullstack-run/` (gitignored)

An honest probe of what the current Chorale pipeline does when asked to build a **real, production-grade
fullstack application** (not the deliberately-small grand-tour demo). The goal was evidence, not a
demo — to map exactly where the pipeline succeeds and where it breaks, so we can scope the work to
close the gap.

## Setup
- **Prompt:** build a production-grade fullstack "Notes" app — Express REST API (routes/controllers/
  models/middleware), SQLite with `users`+`notes` tables, JWT auth (bcrypt, register/login, protected
  routes), a React frontend (Login/Register/dashboard) wired to the API, `package.json` for both, a
  README, validation, error handling, `.env` config, then backend tests, run — "industry standards".
- **Models:** default routing (gemma-4-31B primary, gpt-oss-120B on fallback). No forced escalation.
- **Isolation:** built into `experiments/fullstack-run/` with full trace.

## Result at a glance
- **5/7 agents** (orchestrator, planner, coder, test-writer, reviewer). **research** and **scribe** not reached.
- **183 s**, ~7 of an **11-step plan** executed.
- Output: a **backend-only** project — no frontend, no README, no tests.

## What worked well ✅
The planner correctly recognized the scale — an **11-step plan** (vs 6 for the demo), validated in one
pass. The coder produced a **genuinely well-structured backend** (not stubs):

```
backend/  app.js server.js
  routes/       authRoutes.js notesRoutes.js
  controllers/  authController.js notesController.js
  middleware/   auth.js validate.js
  models/       db.js schema.js
  .env.example  package.json  (express, bcryptjs, jsonwebtoken, sqlite3, dotenv)
```

Tested live:
- **Server boots** — connects to SQLite, creates `users` + `notes` tables.
- **`POST /auth/register` works** — bcrypt-hashes the password, inserts, returns `201`.
- **Auth middleware works** — `GET /notes` without a token → `401`.

So **per-file, per-domain quality on the cheap model is good** — proper MVC layering, real auth
dependencies, a working database. That is a meaningful positive.

## What broke / fell short ❌
1. **No frontend at all.** The entire React half is missing. The orchestrator executed only ~7 of 11
   steps in a single turn, then stopped — the frontend steps were never delegated.
2. **Not runnable end-to-end.** `POST /auth/login` returns `{"error":"Server configuration error"}` —
   the code correctly requires `JWT_SECRET`, but there is only `.env.example` (no real `.env`) and **no
   README** to say so. Register works; login/tokens do not.
3. **No tests.** `test-writer` was delegated but produced **no test file** — it no-opped on the complex
   backend.
4. **No docs.** `scribe` never ran (the turn ended first).

## Root causes (the real lessons)
- **The orchestrator executes the whole plan in ONE turn**, bounded by its step/context budget. An
  11-step plan overflows it, so it stops partway (at the backend). **This is the #1 reason the app is
  incomplete.**
- **Specialists can't see each other's work.** Each delegation is a fresh sub-agent with no shared
  "project contract" (the actual routes, schema, API shape). Even if the frontend step had run, it
  couldn't reliably match a backend it can't see.
- **Nothing verifies the whole app runs.** The coder's verify checks each file compiles; nobody boots
  the app and drives register→login→CRUD, so the missing-`.env`/broken-login gap sailed through.
- **The bottleneck is orchestration/coherence, not per-file quality.** gemma wrote a clean backend; it
  is *completeness across a large plan* that fails.

**Verdict:** Chorale is genuinely good at **structured single-domain generation** (this backend is
production-*shaped* and mostly works). It is **not yet** capable of a **complete, coherent, runnable
multi-domain fullstack app**. What it finished is a solid backend scaffold, not a fullstack application.

## Scoped capability work (priority order)
1. **Plan-execution across turns** *(biggest lever — in progress).* Run a plan as a **tracked,
   resumable loop** — delegate a step, mark it done, continue until *all* steps complete — instead of
   cramming N steps into one turn's budget. This is the direct fix for the incomplete build.
2. **Shared project contract between specialists.** After each step, thread forward the real artifacts
   (routes, schema, data model, types) so later steps (the frontend) build against the *actual*
   backend, not a guess.
3. **An end-to-end "does it actually run" gate.** Boot the app and drive the primary flow
   (register→login→protected CRUD); flag setup gaps (missing `.env`, no README). Catches exactly the
   login/`JWT_SECRET` break.
4. **Scaffolding tools.** A `scaffold` capability (`create-vite`/`create-next-app`, migration runners)
   so the coder starts from a real framework skeleton instead of hand-writing every file.
5. **Model escalation for hard integration steps** (frontend↔backend wiring, auth flows) — the fallback
   infra exists; escalate on complex steps.
6. **Budgets that scale with plan size** — `maxSteps`, context, delegation depth grow for an 11-step
   build vs a 3-step one.

**Recommendation:** #1 + #3 move the needle most — the first makes it *finish*, the second makes what it
finishes *actually run*; #2 makes the frontend and backend cohere. **Work starts on #1.**

---

## Progress — levers #1–#3 built, and the "moving failure mode"

Each lever was built deterministically (pure core + unit tests) and validated against a *real* failure
from an experiment run. The instructive pattern: **every fix completes one class of failure and
reveals the next** — the cheap model keeps producing new, plausible-looking-but-broken output.

### #1 — plan execution across turns ✅ (`src/core/plan-exec.ts`, opt-in `CHORALE_PLAN_EXEC=1`)
`executePlan` runs **every** step in dependency order, delegating each to its assigned specialist and
threading context forward. The agent's turn then only synthesizes.
- **First cut failed loudly:** it "completed 10/10 steps" in 68s but wrote **0 files** — the coders
  thrashed on `mkdir` and no-opped, and nothing verified they'd produced anything. Fixed with a clear
  "write the files" instruction + **per-step file verification and a retry**.
- **Result:** the build now *completes* — TS backend (MVC) + React/TS frontend + tests + README + `.env`
  (28 files) vs backend-only before. **The whole plan runs.**

### #2 — shared project contract ✅ (`src/core/contract.ts`)
`extractContract` reads the files built so far and pulls the concrete contract — **composed endpoints**
(mount prefix + route path → `POST /auth/login`), base URL, DB tables, exports — injected into later
steps so they match reality instead of guessing.
- **Proven** on a real complete backend: extracted exactly `POST /auth/register`, `GET /notes`,
  `DELETE /notes/:id`, no invented `/api`.
- **Caveat:** its payoff depends on the backend actually exposing a coherent API. On a run where the
  backend came out incomplete, there was no contract to thread and the frontend guessed `/api` again —
  a *completeness* problem, which is #3's job.

### #3 — runnability gate ✅ (`src/core/runnable.ts`)
`checkRunnable` statically flags, per `package.json` unit: **no-entry** (server framework but nothing
`.listen()`s), **broken-start** (start script → missing file), **missing-env** (needs `JWT_SECRET` with
no `.env`), **missing-import** (dangling local import), and **unmounted-routes** (route files that exist
but are never `app.use`'d). Repairs loop back to the coder.
- **Caught the exact experiment-3 backend** — missing `src/server.js`, no `.listen()`, absent `.env`.
- **The e2e run then exposed a gap in the gate itself:** a build passed the gate (server *did* start)
  but served only `/health` — `server.js` never mounted its route files, so `POST /register` and
  `POST /auth/register` both 404'd. Added the **unmounted-routes** check, which now flags exactly that.

### Run-by-run failure modes (the honest story)
| Run | Outcome | Failure mode |
|-----|---------|--------------|
| exp-1 (no plan-exec) | backend-only, 7/11 steps | ran out of one turn's budget |
| exp-2 (#1, first cut) | 0 files | steps "ok" but no-op'd; no verification |
| exp-2 (#1 fixed) | full stack, 28 files | **completes**; frontend↔backend contract mismatch (`/api`) |
| exp-3 (#1+#2) | incomplete backend | no server/routes → nothing to thread a contract from |
| e2e (#1+#2+#3) | complete, boots, gate "passed" | server didn't mount its routes → API dead (gate gap, now closed) |

**Where it stands:** Chorale can now build a **complete, structurally-runnable fullstack skeleton**
(all layers, boots, passes static checks) — a real jump from "backend-only demo." What the deterministic
gates can't fully overcome is the cheap model's **cross-file coherence inconsistency**. That points at
the remaining quality lever:

### #5 — model escalation for hard/failed steps (in progress)
Use the cheap model first; **escalate the retry/repair to the stronger model** (gpt-oss-120B) when a
step no-ops or the runnability gate keeps failing — the "compensation" philosophy applied per step. This
targets exactly the coherence errors (unmounted routes, contract guesses) at their source, only paying
for the stronger model when the cheap one already failed.

*(Levers #4 scaffolding and #6 scaled budgets remain, lower priority.)*

/**
 * Validates the reviewer grader against synthetic review texts — NO model calls,
 * so it's free and deterministic. A perfect review must score 100% recall; an
 * empty one 0%; a clean control must flag a false BLOCKER as a false positive.
 * Run: npx tsx eval/reviewer-selftest.ts
 */
import { FIXTURES, RAMP, gradeReview } from "./reviewer-fixtures.js";
import { PRECISION, MULTI, POLYGLOT, EXPERT, DIFF, MULTIFILE } from "./reviewer-suites.js";
import type { Fixture } from "./reviewer-fixtures.js";

let ok = true;
const expect = (label: string, got: string | number, want: string | number): void => {
  const pass = got === want;
  if (!pass) ok = false;
  process.stdout.write(`  ${pass ? "✓" : "✗"} ${label}: ${got}${pass ? "" : ` (expected ${want})`}\n`);
};

const defectFixtures = FIXTURES.filter((f) => !f.clean);
const clean = FIXTURES.find((f) => f.clean)!;

// 1) A "perfect" review naming every defect's first term → 100% recall each.
for (const f of defectFixtures) {
  const perfect =
    f.defects
      .map((d) => `- [BLOCKER] ${f.id}.js:${d.line} — ${d.terms[0]} problem here. Why: bad. Fix: fix it.`)
      .join("\n") + "\nVERDICT: BLOCK — has issues.";
  const g = gradeReview(f, perfect);
  expect(`perfect catches ${f.id}`, `${g.caught.length}/${f.defects.length}`, `${f.defects.length}/${f.defects.length}`);
}

// 2) An empty/irrelevant review → 0% recall (nothing caught).
for (const f of defectFixtures) {
  const g = gradeReview(f, "Looks great to me.\nVERDICT: APPROVE — clean.");
  expect(`empty misses ${f.id}`, g.caught.length, 0);
}

// 3) Clean control: a correct review (APPROVE, no severe findings) → no false positive.
{
  const g = gradeReview(clean, "Nicely written and correct.\nVERDICT: APPROVE — clean.");
  expect("clean control: no false blocker", g.falseBlockers, 0);
  expect("clean control: recall", g.recall, 1);
}

// 4) Clean control WITH a bogus BLOCKER → detected as a false positive.
{
  const g = gradeReview(clean, "- [BLOCKER] clamp.js:2 — invented problem.\nVERDICT: BLOCK — nope.");
  expect("clean control: false blocker caught", g.falseBlockers, 1);
  expect("clean control: recall drops to 0", g.recall, 0);
}

// 5) Verdict parsing.
{
  const g = gradeReview(defectFixtures[0]!, "stuff\nVERDICT: REQUEST CHANGES — fix the query.");
  expect("verdict parsed", g.verdict ?? "null", "REQUEST CHANGES");
}

// 6) Ramp: 10 levels, contiguous 1..10; a perfect review catches each, an empty one none.
{
  const levelsSorted = [...RAMP].map((f) => f.level).sort((a, b) => a! - b!);
  expect("ramp has 10 levels", RAMP.length, 10);
  expect("ramp levels 1..10", levelsSorted.join(","), "1,2,3,4,5,6,7,8,9,10");
  for (const f of RAMP) {
    const perfect = `- [MAJOR] ${f.id}.js:${f.defects[0]!.line} — ${f.defects[0]!.terms[0]} here.`;
    expect(`ramp perfect catches ${f.id}`, gradeReview(f, perfect).caught.length, 1);
    expect(`ramp empty misses ${f.id}`, gradeReview(f, "Looks fine to me.").caught.length, 0);
  }
}

// 7) Suites: PRECISION clean-controls flag bogus severe findings; defect suites credit by terms.
{
  for (const f of PRECISION) {
    expect(`precision ${f.id} is a clean control`, f.clean ? "clean" : "defect", "clean");
    expect(`precision ${f.id} no false positive on APPROVE`, gradeReview(f, "Correct.\nVERDICT: APPROVE").falseBlockers, 0);
    expect(`precision ${f.id} flags a bogus BLOCKER`, gradeReview(f, "- [BLOCKER] x:1 — bogus.").falseBlockers, 1);
  }
  for (const f of [...MULTI, ...POLYGLOT, ...EXPERT.filter((x) => !x.clean), ...DIFF.filter((x) => !x.clean)]) {
    const perfect = f.defects.map((d) => `- [MAJOR] x:${d.line} — ${d.terms[0]}.`).join("\n");
    expect(`suite perfect catches all of ${f.id}`, `${gradeReview(f, perfect).caught.length}/${f.defects.length}`, `${f.defects.length}/${f.defects.length}`);
    expect(`suite empty misses ${f.id}`, gradeReview(f, "No issues.").caught.length, 0);
  }
}

// 8) Multi-file (cross-contract) fixtures grade via the same term-match.
{
  for (const f of MULTIFILE) {
    if (f.clean) {
      expect(`multifile ${f.id} clean control`, gradeReview(f as unknown as Fixture, "Consistent.\nVERDICT: APPROVE").falseBlockers, 0);
    } else {
      const perfect = f.defects.map((d) => `- [MAJOR] x — ${d.terms[0]}.`).join("\n");
      expect(`multifile perfect catches ${f.id}`, gradeReview(f as unknown as Fixture, perfect).caught.length, f.defects.length);
      expect(`multifile empty misses ${f.id}`, gradeReview(f as unknown as Fixture, "All consistent.").caught.length, 0);
    }
  }
}

process.stdout.write(ok ? "\n✅ reviewer grader validated\n" : "\n❌ reviewer grader validation FAILED\n");
process.exit(ok ? 0 : 1);

/**
 * Validates the reviewer grader against synthetic review texts — NO model calls,
 * so it's free and deterministic. A perfect review must score 100% recall; an
 * empty one 0%; a clean control must flag a false BLOCKER as a false positive.
 * Run: npx tsx eval/reviewer-selftest.ts
 */
import { FIXTURES, gradeReview } from "./reviewer-fixtures.js";

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

process.stdout.write(ok ? "\n✅ reviewer grader validated\n" : "\n❌ reviewer grader validation FAILED\n");
process.exit(ok ? 0 : 1);

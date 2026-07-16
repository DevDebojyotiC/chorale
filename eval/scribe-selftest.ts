/**
 * Validate the scribe graders with synthetic inputs — no model calls.
 * Run: npx tsx eval/scribe-selftest.ts
 */
import { GROUND, STALE, EDIT, GEN, TEXT, gradeGroundRecall, gradeStaleness, gradeEdit, gradeContent } from "./scribe-fixtures.js";

let ok = true;
const expect = (label: string, got: string | number | boolean, want: string | number | boolean): void => {
  const pass = got === want;
  if (!pass) ok = false;
  process.stdout.write(`  ${pass ? "✓" : "✗"} ${label}: ${got}${pass ? "" : ` (expected ${want})`}\n`);
};

// Groundedness recall
for (const g of GROUND) {
  const good = gradeGroundRecall(`See ${g.expect.join(" and ")} for details.`, g.expect);
  expect(`ground ${g.id}: full recall`, good.missed.length, 0);
  expect(`ground ${g.id}: empty recall`, gradeGroundRecall("Nothing here.", g.expect).covered.length, 0);
}

// Staleness detection
for (const s of STALE) {
  const perfect = s.planted.map((p) => p.terms[0]).join(" ");
  expect(`stale ${s.id}: perfect catches all`, gradeStaleness(perfect, s.planted).caught.length, s.planted.length);
  expect(`stale ${s.id}: empty catches none`, gradeStaleness("looks fine", s.planted).caught.length, 0);
}

// Edit safety
for (const e of EDIT) {
  const fixed = "The function retries the request up to 3 times, and if it keeps failing it throws an error on port 8080.";
  expect(`edit ${e.id}: clean fix ok`, gradeEdit(fixed, e).ok, true);
  expect(`edit ${e.id}: dropped fact fails`, gradeEdit(fixed.replace("8080", "9090"), e).ok, false);
  expect(`edit ${e.id}: surviving typo fails`, gradeEdit(e.content, e).ok, false);
}

// gradeContent: recall + must-absent + structure, over every GEN/TEXT fixture.
// A snippet that satisfies every structure regex used by the fixtures.
const STRUCT = "\n# Heading text\n## Development\n### Added\n- item\n| a | b | c |\n/** doc */\n[x](#y)\n";
for (const f of [...GEN, ...TEXT]) {
  const perfect = f.expectTerms.join(" ") + STRUCT;
  expect(`content ${f.id}: perfect ok`, gradeContent(perfect, f).ok, true);
  expect(`content ${f.id}: missing term fails`, gradeContent("nothing relevant", f).ok, false);
  if (f.mustAbsent?.length) expect(`content ${f.id}: leaked term fails`, gradeContent(perfect + " " + f.mustAbsent[0], f).ok, false);
}

process.stdout.write(ok ? "\n✅ scribe graders validated\n" : "\n❌ scribe grader validation FAILED\n");
process.exit(ok ? 0 : 1);

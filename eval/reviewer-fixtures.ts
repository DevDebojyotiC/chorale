/**
 * Reviewer benchmark fixtures + grader.
 *
 * Each fixture is a small code sample with KNOWN, planted defects (or a clean
 * control). The reviewer is graded on RECALL — did it catch each planted defect —
 * and PRECISION — did it avoid raising BLOCKER/MAJOR findings on clean code.
 *
 * A defect counts as "caught" if any of its accepted signature terms appears in
 * the review text (case-insensitive). Terms are curated to be discriminating, so
 * a generic review can't score by luck.
 */

export interface Defect {
  key: string;
  /** 1-based line in the raw `code` where the defect lives (for reference/reporting). */
  line: number;
  /** Any of these substrings (lowercased) in the review = caught. */
  terms: string[];
}

export interface Fixture {
  id: string;
  title: string;
  lang: string;
  /** Raw source (no line numbers). The harness numbers it before prompting. */
  code: string;
  defects: Defect[];
  /** A control with no planted defects — used to measure false positives. */
  clean?: boolean;
}

export const FIXTURES: Fixture[] = [
  {
    id: "sql-injection",
    title: "SQL injection via string concatenation",
    lang: "js",
    code: `export function getUser(db, name) {
  const sql = "SELECT * FROM users WHERE name = '" + name + "'";
  return db.query(sql);
}`,
    defects: [
      {
        key: "sql-injection",
        line: 2,
        terms: ["sql injection", "injection", "parameteriz", "prepared statement", "unsanitiz", "sanitiz"],
      },
    ],
  },
  {
    id: "off-by-one",
    title: "Off-by-one indexing the last element",
    lang: "js",
    code: `export function last(arr) {
  return arr[arr.length];
}`,
    defects: [
      {
        key: "off-by-one",
        line: 2,
        terms: ["off-by-one", "off by one", "length - 1", "length-1", "out of bounds", "out-of-bounds", "one past"],
      },
    ],
  },
  {
    id: "missing-await",
    title: "Missing await — returns from a pending Promise",
    lang: "js",
    code: `export async function save(db, doc) {
  const res = db.insert(doc);
  return res.id;
}`,
    defects: [
      {
        key: "missing-await",
        line: 2,
        terms: ["await", "not awaited", "unawaited", "returns a promise", "pending promise", "race"],
      },
    ],
  },
  {
    id: "hardcoded-secret",
    title: "Hardcoded API credential",
    lang: "js",
    code: `const API_KEY = "sk-live-8f3a91c0e5b74d2f";
export function client() {
  return connect(API_KEY);
}`,
    defects: [
      {
        key: "hardcoded-secret",
        line: 1,
        terms: ["hardcoded", "hard-coded", "hard coded", "secret", "credential", "api key", "environment variable", "env var"],
      },
    ],
  },
  {
    id: "unguarded-null",
    title: "Unguarded property access crashes on null input",
    lang: "js",
    code: `export function initials(user) {
  return user.name.split(" ").map((w) => w[0]).join("");
}`,
    defects: [
      {
        key: "unguarded-null",
        line: 2,
        terms: ["null", "undefined", "guard", "optional chaining", "?.", "throws", "crash", "missing check"],
      },
    ],
  },
  {
    id: "clean-clamp",
    title: "Correct clamp (control — no defects)",
    lang: "js",
    code: `export function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}`,
    defects: [],
    clean: true,
  },
];

export interface ReviewGrade {
  id: string;
  clean: boolean;
  caught: string[];
  missed: string[];
  /** defect fixtures: caught/total. clean fixtures: 1 if no false BLOCKER/MAJOR else 0. */
  recall: number;
  /** count of BLOCKER/MAJOR findings — a false-positive signal on clean fixtures. */
  falseBlockers: number;
  verdict: string | null;
}

/** Present code with 1-based line numbers so the reviewer can cite `file:line`. */
export function numberedCode(code: string): string {
  return code
    .split("\n")
    .map((l, i) => `${String(i + 1).padStart(3, " ")}  ${l}`)
    .join("\n");
}

const SEVERE = /-\s*\[\s*(BLOCKER|MAJOR)\s*\]/gi;
const VERDICT = /VERDICT:\s*([A-Z][A-Z ]*[A-Z])/i;

export function gradeReview(fixture: Fixture, review: string): ReviewGrade {
  const text = review.toLowerCase();
  const caught: string[] = [];
  const missed: string[] = [];
  for (const d of fixture.defects) {
    if (d.terms.some((t) => text.includes(t.toLowerCase()))) caught.push(d.key);
    else missed.push(d.key);
  }
  const falseBlockers = (review.match(SEVERE) ?? []).length;
  const verdict = review.match(VERDICT)?.[1]?.trim().toUpperCase() ?? null;

  const recall = fixture.clean
    ? falseBlockers === 0
      ? 1
      : 0
    : fixture.defects.length === 0
      ? 1
      : caught.length / fixture.defects.length;

  return { id: fixture.id, clean: !!fixture.clean, caught, missed, recall, falseBlockers, verdict };
}

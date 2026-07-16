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
  /** Ramp position (1 = easiest to spot, 10 = subtlest). Present only on RAMP fixtures. */
  level?: number;
  /** Short human note on why this defect is hard to catch. */
  difficulty?: string;
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

/**
 * Difficulty ramp — 10 planted defects of increasing subtlety (L1 easiest to spot,
 * L10 subtlest). Each is real, single, and graded by curated signature terms so a
 * vague review can't score. The axis is "how hard is this bug to SEE," not "how big
 * is the program." Used by `reviewer-ramp.ts` to find each model's review ceiling.
 */
export const RAMP: Fixture[] = [
  {
    id: "L1-sort-comparator",
    level: 1,
    difficulty: "common gotcha: Array#sort defaults to string order",
    title: "Numeric median with a default (lexicographic) sort",
    lang: "js",
    code: `export function median(nums) {
  const s = nums.sort();
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}`,
    defects: [
      {
        key: "sort-comparator",
        line: 2,
        terms: ["lexicographic", "sorts as strings", "string sort", "default sort", "comparator", "(a, b) => a - b", "a - b", "sort without"],
      },
    ],
  },
  {
    id: "L2-slice-off-by-one",
    level: 2,
    difficulty: "boundary math hidden in a slice",
    title: "Pagination slice returns one extra, overlapping item",
    lang: "js",
    code: `export function page(items, pageNum, size) {
  const start = pageNum * size;
  return items.slice(start, start + size + 1);
}`,
    defects: [
      {
        key: "slice-off-by-one",
        line: 3,
        terms: ["off-by-one", "off by one", "size + 1", "+ 1", "one extra", "overlap", "duplicate item", "should be start + size"],
      },
    ],
  },
  {
    id: "L3-foreach-async",
    level: 3,
    difficulty: "async control flow: forEach ignores the returned promises",
    title: "saveAll returns before its inserts finish",
    lang: "js",
    code: `export async function saveAll(db, docs) {
  docs.forEach(async (d) => {
    await db.insert(d);
  });
  return "done";
}`,
    defects: [
      {
        key: "foreach-async",
        line: 2,
        terms: ["foreach", "not awaited", "does not await", "fire-and-forget", "for...of", "for..of", "promise.all", "returns before", "won't wait", "will not wait"],
      },
    ],
  },
  {
    id: "L4-float-money",
    level: 4,
    difficulty: "floating-point money — result looks right until it isn't",
    title: "Cents total accumulates float error",
    lang: "js",
    code: `export function totalCents(dollarAmounts) {
  return dollarAmounts.reduce((sum, d) => sum + d * 100, 0);
}`,
    defects: [
      {
        key: "float-money",
        line: 2,
        terms: ["floating point", "floating-point", "float", "rounding", "math.round", "precision", "not an integer", "19.99", "cents"],
      },
    ],
  },
  {
    id: "L5-var-closure",
    level: 5,
    difficulty: "classic closure-over-var capture",
    title: "Handlers all capture the final loop index",
    lang: "js",
    code: `export function makeHandlers(names) {
  const out = {};
  for (var i = 0; i < names.length; i++) {
    out[names[i]] = () => names[i];
  }
  return out;
}`,
    defects: [
      {
        key: "var-closure",
        line: 3,
        terms: ["closure", "loop variable", "var i", "let instead", "instead of let", "captures the same", "same i", "final value", "hoisted", "all handlers return"],
      },
    ],
  },
  {
    id: "L6-path-traversal",
    level: 6,
    difficulty: "security: unsanitized path join",
    title: "Doc reader vulnerable to path traversal",
    lang: "js",
    code: `import { readFileSync } from "node:fs";
export function readDoc(name) {
  return readFileSync("./docs/" + name, "utf8");
}`,
    defects: [
      {
        key: "path-traversal",
        line: 3,
        terms: ["path traversal", "traversal", "../", "directory traversal", "sanitiz", "normalize", "escape the", "path.resolve", "outside the"],
      },
    ],
  },
  {
    id: "L7-memoize-args",
    level: 7,
    difficulty: "subtle logic: cache ignores its inputs",
    title: "memoize returns the first result for every argument",
    lang: "js",
    code: `export function memoize(fn) {
  let cached;
  let has = false;
  return (...args) => {
    if (!has) {
      cached = fn(...args);
      has = true;
    }
    return cached;
  };
}`,
    defects: [
      {
        key: "memoize-args",
        line: 5,
        terms: ["ignores the argument", "ignores its argument", "regardless of", "different argument", "cache key", "key by", "only caches the first", "same result for", "never recompute", "does not key"],
      },
    ],
  },
  {
    id: "L8-toctou-race",
    level: 8,
    difficulty: "concurrency: read-modify-write with an await gap",
    title: "increment loses updates under concurrency",
    lang: "js",
    code: `export async function increment(store, key) {
  const val = await store.get(key);
  await store.set(key, (val ?? 0) + 1);
}`,
    defects: [
      {
        key: "toctou-race",
        line: 2,
        terms: ["race", "toctou", "lost update", "concurrent", "atomic", "read-modify-write", "interleav", "two callers", "check-then-act", "not atomic"],
      },
    ],
  },
  {
    id: "L9-redos",
    level: 9,
    difficulty: "security: catastrophic regex backtracking",
    title: "Tag validator with a ReDoS-prone pattern",
    lang: "js",
    code: `export function isValidTag(s) {
  return /^(\\w+\\s?)+$/.test(s);
}`,
    defects: [
      {
        key: "redos",
        line: 2,
        terms: ["redos", "backtrack", "catastrophic", "exponential", "nested quantifier", "denial of service", "dos", "pathological", "polynomial"],
      },
    ],
  },
  {
    id: "L10-prototype-pollution",
    level: 10,
    difficulty: "security: prototype pollution via recursive merge of untrusted JSON",
    title: "deepMerge pollutes Object.prototype on __proto__ keys",
    lang: "js",
    code: `export function deepMerge(target, source) {
  for (const k of Object.keys(source)) {
    if (source[k] && typeof source[k] === "object") {
      target[k] = deepMerge(target[k] || {}, source[k]);
    } else {
      target[k] = source[k];
    }
  }
  return target;
}`,
    defects: [
      {
        key: "prototype-pollution",
        line: 4,
        terms: ["prototype pollution", "__proto__", "constructor", "prototype", "pollut", "proto key"],
      },
    ],
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

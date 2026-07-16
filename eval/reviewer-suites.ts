/**
 * Additional reviewer benchmark suites beyond the base bench + ramp:
 *
 *  - PRECISION — tricky-but-CORRECT code the reviewer must NOT flag as BLOCKER/MAJOR.
 *    A world-class reviewer resists false alarms (a reviewer that cries wolf is ignored).
 *    Includes probes that specifically tempt over-flagging (safe regex vs ReDoS,
 *    `== null`, `??` for 0, overflow-safe `>>>`, bitmask `&`, `structuredClone`).
 *  - MULTI — files with SEVERAL planted defects; the reviewer must find them ALL, not just the first.
 *  - POLYGLOT — non-JS code (Python), so the reviewer isn't JS-only.
 *
 * All graded by the same `gradeReview` from reviewer-fixtures.ts.
 */
import type { Fixture } from "./reviewer-fixtures.js";

/** Tricky but CORRECT — success = zero BLOCKER/MAJOR findings (NITs are fine). */
export const PRECISION: Fixture[] = [
  {
    id: "P-overflow-safe-mid",
    title: "Overflow-safe binary-search midpoint",
    lang: "js",
    clean: true,
    code: `export function bsearch(arr, x) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = lo + ((hi - lo) >>> 1);
    if (arr[mid] === x) return mid;
    if (arr[mid] < x) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}`,
    defects: [],
  },
  {
    id: "P-eq-null-idiom",
    title: "`== null` catches null and undefined (idiomatic)",
    lang: "js",
    clean: true,
    code: `export function orDefault(x, fallback) {
  if (x == null) return fallback;
  return x;
}`,
    defects: [],
  },
  {
    id: "P-safe-regex-linear",
    title: "Simple linear regex — looks quantified but is NOT ReDoS",
    lang: "js",
    clean: true,
    code: `export function isSlug(s) {
  return /^[a-z0-9-]+$/.test(s);
}`,
    defects: [],
  },
  {
    id: "P-safe-regex-group",
    title: "Anchored single-group repetition — safe, no backtracking",
    lang: "js",
    clean: true,
    code: `export function isPairs(s) {
  return /^(ab)+$/.test(s);
}`,
    defects: [],
  },
  {
    id: "P-nullish-for-zero",
    title: "`??` preserves a valid 0 (|| would be a bug)",
    lang: "js",
    clean: true,
    code: `export function resolvePort(opts) {
  return opts.port ?? 3000;
}`,
    defects: [],
  },
  {
    id: "P-copy-before-sort",
    title: "Copy before sorting with a numeric comparator",
    lang: "js",
    clean: true,
    code: `export function sortedCopy(nums) {
  return [...nums].sort((a, b) => a - b);
}`,
    defects: [],
  },
  {
    id: "P-bitmask-flags",
    title: "Intentional bitmask flag check",
    lang: "js",
    clean: true,
    code: `export const READ = 1, WRITE = 2, EXEC = 4;
export function canWrite(mode) {
  return (mode & WRITE) !== 0;
}`,
    defects: [],
  },
  {
    id: "P-guarded-for-in",
    title: "for-in guarded with Object.hasOwn",
    lang: "js",
    clean: true,
    code: `export function ownEntries(obj) {
  const out = [];
  for (const k in obj) {
    if (!Object.hasOwn(obj, k)) continue;
    out.push([k, obj[k]]);
  }
  return out;
}`,
    defects: [],
  },
  {
    id: "P-structured-clone",
    title: "structuredClone for a deep copy (modern, correct)",
    lang: "js",
    clean: true,
    code: `export function deepCopy(value) {
  return structuredClone(value);
}`,
    defects: [],
  },
];

/** Several real defects in one file — recall must find them ALL. */
export const MULTI: Fixture[] = [
  {
    id: "M-user-handler",
    title: "User lookup: injection + missing await + swallowed error",
    lang: "js",
    code: `export async function handleUser(db, req, res) {
  try {
    const rows = db.query("SELECT * FROM users WHERE id = " + req.query.id);
    const user = rows[0];
    res.json({ name: user.name });
  } catch (e) {}
}`,
    defects: [
      { key: "sql-injection", line: 3, terms: ["sql injection", "injection", "parameteriz", "unsanitiz", "prepared statement"] },
      { key: "missing-await", line: 3, terms: ["await", "not awaited", "returns a promise", "promise", "rows[0]"] },
      { key: "swallowed-error", line: 7, terms: ["swallow", "empty catch", "silently", "ignored", "catch {}", "logs nothing", "hides"] },
    ],
  },
  {
    id: "M-cart-total",
    title: "Cart total: float money + mutates input + off-by-one discount",
    lang: "js",
    code: `export function total(items, discountPct) {
  let sum = 0;
  for (let i = 0; i <= items.length; i++) {
    sum += items[i].price;
  }
  return sum - sum * (discountPct / 100);
}`,
    defects: [
      { key: "off-by-one", line: 3, terms: ["off-by-one", "off by one", "<= items.length", "out of bounds", "undefined", "i < items.length"] },
      { key: "null-access", line: 4, terms: ["undefined", "items[i]", "crash", "throws", "reading 'price'"] },
    ],
  },
  {
    id: "M-token",
    title: "Auth token: hardcoded secret + weak randomness + logged secret",
    lang: "js",
    code: `const SECRET = "s3cr3t-signing-key";
export function makeToken(userId) {
  const nonce = Math.random().toString(36).slice(2);
  const token = sign(userId + nonce, SECRET);
  console.log("issued token", token, "with secret", SECRET);
  return token;
}`,
    defects: [
      { key: "hardcoded-secret", line: 1, terms: ["hardcoded", "hard-coded", "secret", "credential", "environment variable", "env var"] },
      { key: "weak-random", line: 3, terms: ["math.random", "not cryptographically", "insecure random", "weak random", "predictable", "crypto"] },
      { key: "logged-secret", line: 5, terms: ["log", "logs the secret", "sensitive", "leak", "console.log", "logging the token"] },
    ],
  },
];

/**
 * Expert tier — subtle, expertise-heavy defects (and one adversarial CORRECT case)
 * that a single review pass tends to slip on. Used to demonstrate the self-critique
 * pass: hard recall + hard precision in one suite.
 */
export const EXPERT: Fixture[] = [
  {
    id: "X-timing-unsafe",
    title: "HMAC verified with a non-constant-time compare (timing attack)",
    lang: "js",
    code: `import { createHmac } from "node:crypto";
export function verifyMac(body, sig, key) {
  const expected = createHmac("sha256", key).update(body).digest("hex");
  return sig === expected;
}`,
    defects: [
      { key: "timing-unsafe", line: 4, terms: ["timing", "constant-time", "constant time", "timingsafeequal", "timing attack", "side channel", "side-channel"] },
    ],
  },
  {
    id: "X-unverified-token",
    title: "Auth derived from an unverified JWT payload (forgeable)",
    lang: "js",
    code: `export function getUserFromToken(token) {
  const [, payload] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64").toString());
  return { id: claims.sub, admin: claims.admin };
}`,
    defects: [
      { key: "unverified-token", line: 3, terms: ["signature", "not verified", "does not verify", "unverified", "forge", "forged", "tamper", "trusts", "without verifying", "anyone can"] },
    ],
  },
  {
    id: "X-ssrf",
    title: "Server-side fetch of a user-supplied URL (SSRF)",
    lang: "js",
    code: `export async function fetchPreview(userUrl) {
  const res = await fetch(userUrl);
  return await res.text();
}`,
    defects: [
      { key: "ssrf", line: 2, terms: ["ssrf", "server-side request forgery", "allowlist", "allow-list", "allow list", "internal", "metadata endpoint", "user-controlled url", "user-supplied url"] },
    ],
  },
  {
    id: "X-adversarial-telemetry",
    title: "Intentional fire-and-forget telemetry — CORRECT (adversarial precision)",
    lang: "js",
    clean: true,
    code: `// Fire-and-forget: telemetry must never block or throw into the request path.
export function track(event) {
  void fetch("/t", { method: "POST", body: JSON.stringify(event) }).catch(() => {});
}`,
    defects: [],
  },
];

/**
 * Diff review — the reviewer judges a unified diff (the most common real review mode):
 * catch regressions the CHANGE introduces, and don't flag a correct, complete change.
 * `code` holds the diff; the harness frames it as "review this diff".
 */
export const DIFF: Fixture[] = [
  {
    id: "D-dropped-null-guard",
    title: "Refactor drops a null guard (regression)",
    lang: "diff",
    code: `--- a/user.js
+++ b/user.js
@@ -1,4 +1,3 @@
 export function displayName(user) {
-  if (!user) return "Guest";
   return user.name;
 }`,
    defects: [
      { key: "dropped-guard", line: 2, terms: ["null", "guard", "removed", "dropped", "crash", "throws", "undefined", "!user", "guest", "no longer"] },
    ],
  },
  {
    id: "D-flipped-comparison",
    title: "Boundary flipped >= to > (off-by-one regression)",
    lang: "diff",
    code: `--- a/eligibility.js
+++ b/eligibility.js
@@ -1,3 +1,3 @@
 export function isAdult(age) {
-  return age >= 18;
+  return age > 18;
 }`,
    defects: [
      { key: "flipped-comparison", line: 2, terms: ["off-by-one", "boundary", "excludes 18", "18", ">= 18", "> 18", "greater than or equal", "now excludes", "18-year"] },
    ],
  },
  {
    id: "D-typo-field",
    title: "Renamed property introduces a typo (undefined)",
    lang: "diff",
    code: `--- a/parse.js
+++ b/parse.js
@@ -1,3 +1,3 @@
 export function items(data) {
-  return data.results;
+  return data.result;
 }`,
    defects: [
      { key: "typo-field", line: 2, terms: ["result", "results", "typo", "property", "undefined", "wrong field", "renamed", "does not exist"] },
    ],
  },
  {
    id: "D-correct-change",
    title: "Correct improvement — copy + numeric comparator (no regression)",
    lang: "diff",
    clean: true,
    code: `--- a/sort.js
+++ b/sort.js
@@ -1,3 +1,3 @@
 export function sorted(nums) {
-  return nums.sort();
+  return [...nums].sort((a, b) => a - b);
 }`,
    defects: [],
  },
];

/** Non-JS defects — the reviewer must not be JS-only. */
export const POLYGLOT: Fixture[] = [
  {
    id: "PY-mutable-default",
    title: "Python mutable default argument",
    lang: "python",
    code: `def append_item(item, items=[]):
    items.append(item)
    return items`,
    defects: [
      { key: "mutable-default", line: 1, terms: ["mutable default", "default argument", "shared", "items=[]", "default=[]", "none", "persists across calls", "same list"] },
    ],
  },
  {
    id: "PY-sql-fstring",
    title: "Python SQL injection via f-string",
    lang: "python",
    code: `def get_user(cursor, name):
    cursor.execute(f"SELECT * FROM users WHERE name = '{name}'")
    return cursor.fetchone()`,
    defects: [
      { key: "sql-injection", line: 2, terms: ["sql injection", "injection", "parameteriz", "f-string", "placeholder", "unsanitiz", "prepared"] },
    ],
  },
  {
    id: "PY-bare-except",
    title: "Python bare except hides errors + `== None`",
    lang: "python",
    code: `def load(path):
    try:
        data = open(path).read()
    except:
        data = None
    if data == None:
        return {}
    return parse(data)`,
    defects: [
      { key: "bare-except", line: 4, terms: ["bare except", "except:", "catches everything", "keyboardinterrupt", "systemexit", "too broad", "swallow"] },
    ],
  },
];

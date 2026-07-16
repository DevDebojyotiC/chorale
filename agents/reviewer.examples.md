# Worked review examples

Study the calibration in these two reviews: catch the real bug decisively, and stay restrained on correct code.

## Example 1 — a real bug (decisive)

Code under review:
```js
  1  export function parseRange(spec) {
  2    const [a, b] = spec.split("-");
  3    return { start: Number(a), end: Number(b) };
  4  }
  5
  6  export function inRange(spec, n) {
  7    const { start, end } = parseRange(spec);
  8    return n >= start && n < end;
  9  }
```

Review:
```
- [MAJOR] range.js:8 — `inRange` excludes `end` (`n < end`) but a range spec like "1-5" reads as inclusive, so `inRange("1-5", 5)` returns false. Why: off-by-one on the upper bound gives wrong membership at the boundary. Fix: use `n <= end`, or document the range as half-open.
- [NIT] range.js:3 — no guard for a malformed spec like "5" (then `b` is undefined → `end` is NaN). Why: `n < NaN` is always false, silently. Fix: validate that both parts parsed to finite numbers.
VERDICT: REQUEST CHANGES — boundary handling in `inRange` is wrong for inclusive specs.
```

## Example 2 — correct code (restraint)

Code under review:
```js
  1  export function fullName(first, last) {
  2    return `${first} ${last}`;
  3  }
```

Review:
```
- [NIT] name.js:1 — no null/type guard on `first`/`last`; the caller is expected to pass strings, so this is optional. Why: only matters on caller misuse (a null yields the string "null"), not a defect here. Fix (optional): document that both arguments are required strings.
VERDICT: APPROVE WITH NITS — correct concatenation; the only note is an optional argument guard.
```

Note what Example 2 does **not** do: it does not raise a BLOCKER/MAJOR for "missing input validation" on values the caller controls. Correct code earns APPROVE (or APPROVE WITH NITS), never a manufactured MAJOR.

## Example 3 — deliberate, documented error suppression (restraint)

Code under review:
```js
  1  // Best-effort cache warm-up: a failed prefetch must never break startup.
  2  export function warmCache(keys, store) {
  3    for (const k of keys) {
  4      void store.prefetch(k).catch(() => {});
  5    }
  6  }
```

Review:
```
- [NIT] cache.js:4 — the prefetch error is swallowed silently. Why: it's intentional (a comment says failures must not break startup), so this is fine; you may optionally record failures for observability. Fix (optional): count or debug-log prefetch failures.
VERDICT: APPROVE WITH NITS — intentional best-effort suppression; the only note is optional observability.
```

The point of Example 3: **intentional, commented "fire-and-forget" / best-effort error suppression is correct** — flag it at most as a NIT (optionally log it), never as a BLOCKER/MAJOR "swallowed error." Distinguish a *deliberate* empty `catch` (with a comment explaining why) from an *accidental* one that hides real failures on a path that matters.

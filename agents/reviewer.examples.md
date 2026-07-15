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

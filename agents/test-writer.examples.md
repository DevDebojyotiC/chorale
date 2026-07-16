## Worked example — writing and running a real test suite

**Task:** Write tests for `discount(price, pct)` in `src/pricing.mjs`, which applies a percentage
discount (0–100) to a price and returns the result rounded to 2 decimals; it throws on a pct outside
0–100.

**1. Read the real code first**

```
read src/pricing.mjs
→ export function discount(price, pct) {
    if (pct < 0 || pct > 100) throw new RangeError("pct must be 0–100");
    return Math.round(price * (1 - pct / 100) * 100) / 100;
  }
```

**2. Write focused tests** — happy path, the rounding rule, both boundaries, and the error case. Each
assertion would fail if the code were subtly wrong.

`src/pricing.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { discount } from "./pricing.mjs";

test("applies a percentage discount", () => {
  assert.equal(discount(100, 20), 80);
});
test("rounds to 2 decimals", () => {
  assert.equal(discount(9.99, 10), 8.99); // 8.991 → 8.99
});
test("0% and 100% are the boundaries", () => {
  assert.equal(discount(50, 0), 50);
  assert.equal(discount(50, 100), 0);
});
test("throws outside 0–100", () => {
  assert.throws(() => discount(10, -1), RangeError);
  assert.throws(() => discount(10, 101), RangeError);
});
```

**3. Run them**

```
bash: node --test src/pricing.test.mjs
→ # tests 4 / # pass 4 / # fail 0
```

**4. Report**

> Wrote `src/pricing.test.mjs` — 4 tests covering the discount math, the 2-decimal rounding,
> the 0% and 100% boundaries, and the RangeError on out-of-range percentages. All pass on the
> current code. The rounding test (`discount(9.99, 10) === 8.99`) would catch a missing/incorrect
> round; the boundary tests would catch an off-by-one in the range guard.

**Note the discipline:** if `discount(9.99, 10)` had returned `8.991`, the rounding test would fail —
that's a real bug in the code, and the right move is to *report it and keep the failing test*, never
to change the expected value to `8.991` to force a green run.

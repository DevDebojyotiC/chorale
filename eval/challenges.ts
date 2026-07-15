/**
 * Shared coding challenges + grader used by the difficulty ramp (coder-ramp.ts)
 * and the head-to-head bake-off (coder-bakeoff.ts). Pure — no side effects.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Mod = Record<string, any>;

export function eq<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/**
 * Resolve the export under test. Prefer the exact requested name, then `default`,
 * then the sole callable (function/class) export — so a cosmetic name mismatch
 * (e.g. `intToRoman` vs `toRoman`) doesn't mask otherwise-correct logic. We are
 * measuring algorithmic capability, not exact-identifier instruction-following.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pick(m: Mod, name: string): any {
  if (typeof m[name] === "function") return m[name];
  if (typeof m.default === "function") return m.default;
  const fns = Object.values(m).filter((v) => typeof v === "function");
  if (fns.length === 1) return fns[0];
  const ci = Object.entries(m).find(([k, v]) => typeof v === "function" && k.toLowerCase() === name.toLowerCase());
  return ci?.[1] ?? m[name] ?? m.default;
}

export const P = (spec: string): string =>
  `Create a single file named solution.mjs in the current directory. It must use ESM syntax and ` +
  `\`export\` the required symbol. Write ONLY that file, complete and correct. ${spec}`;

export interface Challenge {
  level: number;
  name: string;
  prompt: string;
  test: (m: Mod) => void;
}

export const CHALLENGES: Challenge[] = [
  { level: 1, name: "Roman numerals", prompt: P("Export `toRoman(n)` converting 1..3999 to a Roman-numeral string."),
    test: (m) => { const f = pick(m, "toRoman"); assert(f(4) === "IV" && f(58) === "LVIII" && f(1994) === "MCMXCIV" && f(3999) === "MMMCMXCIX", "roman"); } },
  { level: 2, name: "Balanced brackets", prompt: P("Export `isBalanced(s)` returning true iff ()[]{} are balanced and nested."),
    test: (m) => { const f = pick(m, "isBalanced"); assert(f("()[]{}") && f("([{}])") && !f("(]") && !f("([)]") && f(""), "brackets"); } },
  { level: 3, name: "Expression evaluator", prompt: P("Export `evaluate(str)` for + - * / and parentheses with precedence; returns a number."),
    test: (m) => { const f = pick(m, "evaluate"); assert(f("2+3*4") === 14 && f("(2+3)*4") === 20 && f("10/4") === 2.5 && f("2*(3+(4-1))") === 12, "expr"); } },
  { level: 4, name: "LRU cache", prompt: P("Export class `LRUCache` with constructor(capacity), get(key)->value|-1, put(key,value); evict least-recently-used."),
    test: (m) => { const C = pick(m, "LRUCache"); const c = new C(2); c.put(1, 1); c.put(2, 2); assert(c.get(1) === 1, "g1"); c.put(3, 3); assert(c.get(2) === -1, "e2"); c.put(4, 4); assert(c.get(1) === -1 && c.get(3) === 3 && c.get(4) === 4, "lru"); } },
  { level: 5, name: "JSON parser", prompt: P("Export `parseJSON(str)` parsing JSON WITHOUT JSON.parse: objects, arrays, strings (escapes), numbers, booleans, null, whitespace."),
    test: (m) => { const f = pick(m, "parseJSON"); assert(eq(f('{"a":1,"b":[true,null,"x"]}'), { a: 1, b: [true, null, "x"] }), "j1"); assert(eq(f('{"c":{"d":-2.5,"e":"a\\"b"}}'), { c: { d: -2.5, e: 'a"b' } }), "j2"); assert(eq(f('"hi\\nthere"'), "hi\nthere"), "j3"); } },
  { level: 6, name: "Regex matcher (. and *)", prompt: P("Export `isMatch(s, p)`: regex match where '.' matches any single char and '*' matches zero-or-more of the preceding element. Full-string match."),
    test: (m) => { const f = pick(m, "isMatch"); assert(f("aa", "a") === false && f("aa", "a*") === true && f("ab", ".*") === true && f("aab", "c*a*b") === true && f("mississippi", "mis*is*p*.") === false, "regex"); } },
  { level: 7, name: "Topological order", prompt: P("Export `findOrder(n, prerequisites)`: prerequisites[i]=[a,b] means take b before a. Return a valid ordering of 0..n-1, or [] if impossible (cycle)."),
    test: (m) => {
      const f = pick(m, "findOrder");
      const ok = (n: number, pre: number[][]) => { const o = f(n, pre); if (!Array.isArray(o) || o.length !== n) return false; const pos = new Map(o.map((c: number, i: number) => [c, i])); return pre.every(([a, b]) => pos.has(a) && pos.has(b) && (pos.get(b) as number) < (pos.get(a) as number)); };
      assert(ok(2, [[1, 0]]), "t1");
      const cyc = f(2, [[1, 0], [0, 1]]); assert(Array.isArray(cyc) && cyc.length === 0, "cycle");
      assert(ok(4, [[1, 0], [2, 0], [3, 1], [3, 2]]), "t3");
    } },
  { level: 8, name: "CSV parser", prompt: P("Export `parseCSV(text)` returning an array of rows (arrays of string fields). Support double-quoted fields that may contain commas and newlines; a doubled quote inside a quoted field is a literal quote character."),
    test: (m) => { const f = pick(m, "parseCSV"); assert(eq(f("a,b,c"), [["a", "b", "c"]]), "c1"); assert(eq(f('a,"b,c",d'), [["a", "b,c", "d"]]), "c2"); assert(eq(f('"he said ""hi"""'), [['he said "hi"']]), "c3"); assert(eq(f("a,b\nc,d"), [["a", "b"], ["c", "d"]]), "c4"); } },
  { level: 9, name: "Mini interpreter", prompt: P("Export `run(program)`: statements separated by ';'. Supports variable assignment `name = expr` and arithmetic (+ - * / and parens, variables). Return the value of the final expression."),
    test: (m) => { const f = pick(m, "run"); assert(f("x = 3; y = x * 2; y + 1") === 7, "i1"); assert(f("a = 10; b = a / 2; a + b") === 15, "i2"); assert(f("2 + 3 * 4") === 14, "i3"); } },
  { level: 10, name: "Dijkstra shortest path", prompt: P("Export `shortestPath(edges, n, start, end)`: edges are directed [u,v,w]. Return the minimum total weight from start to end, or -1 if unreachable."),
    test: (m) => { const f = pick(m, "shortestPath"); assert(f([[0, 1, 4], [0, 2, 1], [2, 1, 2], [1, 3, 1], [2, 3, 5]], 4, 0, 3) === 4, "d1"); assert(f([[0, 1, 1]], 2, 1, 0) === -1, "d2"); assert(f([[0, 1, 2], [1, 2, 3]], 3, 0, 2) === 5, "d3"); } },
];

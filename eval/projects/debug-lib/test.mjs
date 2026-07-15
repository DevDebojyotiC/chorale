// Behavioral test suite. Do not modify — fix the bugs in lib/ so every check passes.
import { range, clamp, Emitter } from "./lib/index.mjs";

let pass = 0;
let total = 0;
const check = (name, cond) => {
  total += 1;
  if (cond) {
    pass += 1;
    console.log("ok   " + name);
  } else {
    console.log("FAIL " + name);
  }
};

check("range excludes end", JSON.stringify(range(0, 3)) === JSON.stringify([0, 1, 2]));
check("range with step", JSON.stringify(range(0, 10, 2)) === JSON.stringify([0, 2, 4, 6, 8]));
check("clamp below min", clamp(-5, 0, 10) === 0);
check("clamp above max", clamp(50, 0, 10) === 10);
check("clamp within range", clamp(5, 0, 10) === 5);

const e = new Emitter();
let n = 0;
const f = () => { n += 1; };
const g = () => { n += 10; };
e.on("x", f);
e.on("x", g);
e.emit("x"); // n = 11
e.off("x", f); // remove ONLY f
e.emit("x"); // n += 10 => 21
check("emitter off removes only that listener", n === 21);
check("emit returns false when no listeners", e.emit("nope") === false);

console.log("PASS " + pass + "/" + total);
process.exit(pass === total ? 0 : 1);

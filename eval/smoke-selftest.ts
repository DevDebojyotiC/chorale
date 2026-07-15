/**
 * Deterministic validation that the runtime self-heal check catches the failures
 * it claims to — independent of any model. Run: npx tsx eval/smoke-selftest.ts
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { smokeTest } from "../src/core/smoke.js";

let ok = true;
const check = (name: string, cond: boolean, detail = ""): void => {
  if (!cond) ok = false;
  process.stdout.write(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : "  " + detail}\n`);
};
const tmp = (): string => mkdtempSync(join(tmpdir(), "smoke-"));

// 1. A correct server that reads process.env.PORT → passes.
{
  const d = tmp();
  writeFileSync(join(d, "server.mjs"), `import { createServer } from "node:http";\nconst PORT = process.env.PORT || 3000;\ncreateServer((q, s) => s.end("ok")).listen(PORT);\n`);
  const iss = await smokeTest(["server.mjs"], d);
  check("correct server (reads PORT) passes", iss.length === 0, JSON.stringify(iss));
  rmSync(d, { recursive: true, force: true });
}

// 2. A server that hardcodes the port (ignores PORT) → flagged. THE Gemma bug.
{
  const d = tmp();
  writeFileSync(join(d, "server.mjs"), `import { createServer } from "node:http";\ncreateServer((q, s) => s.end("ok")).listen(34567);\n`);
  const iss = await smokeTest(["server.mjs"], d);
  check("hardcoded-port server is flagged", iss.length === 1 && /PORT/.test(iss[0]?.message ?? ""), JSON.stringify(iss));
  rmSync(d, { recursive: true, force: true });
}

// 3. A module that throws on load → flagged.
{
  const d = tmp();
  writeFileSync(join(d, "m.mjs"), `export const x = 1;\nthrow new Error("boom on load");\n`);
  const iss = await smokeTest(["m.mjs"], d);
  check("throwing module is flagged", iss.length === 1 && /throws when imported/.test(iss[0]?.message ?? ""), JSON.stringify(iss));
  rmSync(d, { recursive: true, force: true });
}

// 4. A clean module → passes.
{
  const d = tmp();
  writeFileSync(join(d, "m.mjs"), `export function add(a, b) { return a + b; }\n`);
  const iss = await smokeTest(["m.mjs"], d);
  check("clean module passes", iss.length === 0, JSON.stringify(iss));
  rmSync(d, { recursive: true, force: true });
}

process.stdout.write(ok ? "\n✅ smoke self-heal validated\n" : "\n❌ smoke validation FAILED\n");
process.exit(ok ? 0 : 1);

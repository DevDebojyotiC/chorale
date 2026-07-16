/**
 * Generate one showcase HTML per topic profile, exercising that profile's signature
 * components with realistic dummy content (from profile-demos.ts), each sized to a
 * topic-appropriate length (invoice ~1 page … research paper ~10; see doc-pages.ts).
 * All light + print-friendly. Usage: npx tsx eval/gen-profiles.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildHtmlDoc, type ThemeName } from "../src/tools/doc-themes.js";
import { scoreDesign } from "./scribe-design.js";
import { DEMOS } from "./profile-demos.js";

const outDir = resolve(process.cwd(), "docs");
// ~1,900 chars of rendered A4 body ≈ one page; used only for a rough page estimate in the log.
const CHARS_PER_PAGE = 4200;

for (const [name, body] of Object.entries(DEMOS)) {
  const html = buildHtmlDoc(body, name as ThemeName);
  const file = resolve(outDir, `scribe-profile-${name}.html`);
  writeFileSync(file, html, "utf8");
  const s = scoreDesign(html);
  const pages = Math.max(1, Math.round(body.length / CHARS_PER_PAGE));
  process.stdout.write(`  scribe-profile-${name.padEnd(10)} ${String(html.length).padStart(6)}b  ~${pages}pp  ${s.lightSafe ? "light✓" : "DARK✗"}\n`);
}
process.stdout.write(`\nWrote ${Object.keys(DEMOS).length} profile demos to docs/scribe-profile-*.html\n`);
process.exit(0);

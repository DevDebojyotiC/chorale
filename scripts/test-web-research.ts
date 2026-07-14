// Free (no-LLM) check that web_research actually searches + reads pages.
import { webResearch } from "../src/tools/web.js";

const execute = (webResearch as { execute: (input: unknown, opts: unknown) => Promise<unknown> }).execute;
const out = (await execute({ query: "Node.js latest LTS version", read_top: 2 }, {})) as {
  read?: Array<{ title: string; url: string; content: string }>;
  other_results?: Array<{ title: string; url: string }>;
  note?: string;
  error?: string;
};

if (out.error) {
  console.error("TOOL ERROR:", out.error);
  process.exit(1);
}
if (out.note) console.log("NOTE:", out.note, "\n");
console.log(`read ${out.read?.length ?? 0} pages, ${out.other_results?.length ?? 0} other results\n`);
for (const r of out.read ?? []) {
  console.log(`# ${r.title}\n  ${r.url}\n  content[0:220]: ${r.content.slice(0, 220).replace(/\s+/g, " ")}\n`);
}
process.exit((out.read?.length ?? 0) > 0 ? 0 : 1);

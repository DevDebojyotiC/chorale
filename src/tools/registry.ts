import type { ToolSet } from "ai";
import { webSearch, webFetch, webResearch } from "./web.js";

/** All built-in tools, keyed by the name agents reference in their `tools:` list. */
export const builtinTools: ToolSet = {
  web_research: webResearch,
  web_search: webSearch,
  web_fetch: webFetch,
};

/** Build the ToolSet for an agent from its allow-list of tool names. */
export function selectTools(names: string[]): ToolSet {
  const set: ToolSet = {};
  for (const name of names) {
    const t = builtinTools[name];
    if (t) {
      set[name] = t;
    } else {
      process.stderr.write(`[chorale] warning: agent references unknown tool "${name}"\n`);
    }
  }
  return set;
}

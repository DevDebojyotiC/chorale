import type { ToolSet } from "ai";
import { webSearch, webFetch, webResearch } from "./web.js";
import { createFileTools, READ_ONLY_FILE_TOOLS, WRITE_FILE_TOOLS } from "./fs.js";
import { createDocumentTools, READ_ONLY_DOC_TOOLS, WRITE_DOC_TOOLS } from "./documents.js";
import { createShellTools } from "./shell.js";
import type { ToolContext } from "./permissions.js";

/** Static, always-safe tools keyed by the name agents reference in their `tools:` list. */
const staticTools: ToolSet = {
  web_research: webResearch,
  web_search: webSearch,
  web_fetch: webFetch,
};

/** Tools handled elsewhere in the runtime (not built here). */
const RUNTIME_TOOLS = new Set(["delegate", "skill_view"]);

/**
 * Build an agent's ToolSet from its tool name allow-list, applying the permission
 * mode: read-only tools always; write tools omitted in read-only mode; shell
 * omitted in read-only mode (and approval-gated at execution).
 */
export function buildToolSet(names: string[], ctx: ToolContext): ToolSet {
  const fileTools = createFileTools(ctx);
  const docTools = createDocumentTools(ctx);
  const shellTools = createShellTools(ctx);
  const out: ToolSet = {};

  for (const name of names) {
    if (RUNTIME_TOOLS.has(name)) continue; // added separately by the runtime

    if (staticTools[name]) {
      out[name] = staticTools[name];
    } else if (READ_ONLY_FILE_TOOLS.has(name)) {
      out[name] = fileTools[name]!;
    } else if (WRITE_FILE_TOOLS.has(name)) {
      if (ctx.mode !== "read-only") out[name] = fileTools[name]!;
    } else if (READ_ONLY_DOC_TOOLS.has(name)) {
      out[name] = docTools[name]!;
    } else if (WRITE_DOC_TOOLS.has(name)) {
      if (ctx.mode !== "read-only") out[name] = docTools[name]!;
    } else if (name === "bash") {
      if (ctx.mode !== "read-only") out[name] = shellTools[name]!;
    } else {
      process.stderr.write(`[chorale] warning: agent references unknown tool "${name}"\n`);
    }
  }
  return out;
}

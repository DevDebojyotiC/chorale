// Free (no-LLM) check that the MCP client connects to a real server, materializes
// its tools (namespaced mcp__<server>__<tool>), and can call one.
import { connectMcpServers } from "../src/mcp/client.js";
import type { ChoraleConfig } from "../src/core/config.js";

const target = "agents"; // sandbox the filesystem server at the project's agents/ dir

const config = {
  mcp: {
    servers: {
      fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", target] },
    },
  },
} as unknown as ChoraleConfig;

const mcp = await connectMcpServers(config, ["fs"]);
const toolNames = Object.keys(mcp.tools);
console.log(`materialized ${toolNames.length} MCP tools:`);
console.log("  " + toolNames.join("\n  "));

const list = mcp.tools["mcp__fs__list_directory"] as
  | { execute: (i: unknown, o: unknown) => Promise<unknown> }
  | undefined;
if (list) {
  const out = await list.execute({ path: "." }, {});
  console.log("\nlist_directory(.) →");
  console.log(String(typeof out === "string" ? out : JSON.stringify(out)).slice(0, 400));
}

await mcp.close();
console.log("\nMCP client OK.");
process.exit(0);

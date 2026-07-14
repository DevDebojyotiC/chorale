import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { tool, jsonSchema } from "ai";
import type { ToolSet } from "ai";
import type { ChoraleConfig } from "../core/config.js";

export interface McpConnection {
  /** MCP tools, namespaced `mcp__<server>__<tool>`, ready to hand to streamText. */
  tools: ToolSet;
  /** Close all opened MCP client connections (and their stdio subprocesses). */
  close: () => Promise<void>;
}

/**
 * Connect to the named MCP servers, list their tools, and wrap each as an AI SDK
 * tool. Servers that fail to connect are logged and skipped (never fatal).
 * The caller MUST call `close()` when the run is done.
 */
export async function connectMcpServers(config: ChoraleConfig, serverNames: string[]): Promise<McpConnection> {
  const tools: ToolSet = {};
  const clients: Client[] = [];

  for (const name of serverNames) {
    const cfg = config.mcp.servers[name];
    if (!cfg) {
      process.stderr.write(`[chorale] warning: agent references unknown MCP server "${name}"\n`);
      continue;
    }
    try {
      const client = new Client({ name: "chorale", version: "0.0.0" });
      if (cfg.command) {
        await client.connect(
          new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env: cfg.env }),
        );
      } else if (cfg.url) {
        await client.connect(new StreamableHTTPClientTransport(new URL(cfg.url), {
          requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
        }));
      } else {
        process.stderr.write(`[chorale] warning: MCP server "${name}" has neither command nor url\n`);
        continue;
      }
      clients.push(client);

      const { tools: mcpTools } = await client.listTools();
      for (const t of mcpTools) {
        tools[`mcp__${name}__${t.name}`] = tool({
          description: t.description ?? `${name} · ${t.name}`,
          // MCP tools describe inputs with JSON Schema; the AI SDK accepts it via jsonSchema().
          inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
          execute: async (args) => {
            const res = await client.callTool({ name: t.name, arguments: args as Record<string, unknown> });
            const content = (res.content ?? []) as Array<{ type: string; text?: string }>;
            const text = content
              .map((c) => (c.type === "text" && c.text != null ? c.text : JSON.stringify(c)))
              .join("\n");
            return text || res;
          },
        });
      }
      process.stderr.write(`[chorale] MCP "${name}" connected (${mcpTools.length} tools)\n`);
    } catch (e) {
      process.stderr.write(`[chorale] warning: MCP server "${name}" failed to connect: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  return {
    tools,
    close: async () => {
      await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
    },
  };
}

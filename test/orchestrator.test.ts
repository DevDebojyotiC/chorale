import { describe, it, expect } from "vitest";
import { listAgents } from "../src/agents/loader";
import { createDelegateTool } from "../src/tools/delegate";

// Minimal stand-ins; the delegate tool only touches config.agents.dir + the runner.
const cfg = { agents: { dir: "agents" } } as never;
const reg = {} as never;
const okRunner = async (o: { agent: { name: string }; depth: number }) => ({
  text: `ran ${o.agent.name} @${o.depth}`,
  model: "mock",
  usage: undefined,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = (t: any) => t.execute as (i: unknown, o: unknown) => Promise<any>;

describe("Phase 1 — orchestrator / delegation", () => {
  it("lists agents from the agents dir", () => {
    const names = listAgents("agents").map((a) => a.name);
    expect(names).toContain("research");
    expect(names).toContain("orchestrator");
  });

  it("refuses to delegate beyond the depth limit", async () => {
    const tool = createDelegateTool({ config: cfg, registry: reg, depth: 2, maxDepth: 2, run: okRunner });
    const out = await exec(tool)({ agent: "research", task: "t" }, {});
    expect(out.error).toMatch(/depth limit/i);
  });

  it("errors on an unknown agent", async () => {
    const tool = createDelegateTool({ config: cfg, registry: reg, depth: 0, maxDepth: 2, run: okRunner });
    const out = await exec(tool)({ agent: "does-not-exist", task: "t" }, {});
    expect(out.error).toMatch(/unknown agent/i);
  });

  it("runs a known specialist via the injected runner at depth+1", async () => {
    const tool = createDelegateTool({ config: cfg, registry: reg, depth: 0, maxDepth: 2, run: okRunner });
    const out = await exec(tool)({ agent: "research", task: "find X" }, {});
    expect(out.result).toBe("ran research @1");
    expect(out.agent).toBe("research");
  });
});

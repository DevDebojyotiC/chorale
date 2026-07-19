import { describe, it, expect } from "vitest";
import { createDelegateTool } from "../src/tools/delegate";
import type { ChoraleConfig } from "../src/core/config";
import type { Registry } from "../src/core/model-registry";
import type { RunResult } from "../src/core/runtime";

const ctx = (over: Partial<Parameters<typeof createDelegateTool>[0]> = {}) =>
  createDelegateTool({
    config: { agents: { dir: "agents" } } as unknown as ChoraleConfig,
    registry: {} as unknown as Registry,
    depth: 0,
    maxDepth: 3,
    permissionMode: "full-auto",
    path: ["orchestrator"],
    run: async () => ({ model: "mock", text: "ok", usage: undefined }) as RunResult,
    ...over,
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (t: any, args: any) => t.execute(args, {}) as Promise<any>;

describe("Phase 3 guards — delegation", () => {
  it("refuses a delegation that would create a cycle", async () => {
    const t = ctx({ path: ["orchestrator", "research"] });
    const res = await run(t, { agent: "research", task: "loop" });
    expect(res.error).toMatch(/cycle/i);
  });

  it("refuses once the depth limit is reached", async () => {
    const t = ctx({ depth: 3, maxDepth: 3 });
    const res = await run(t, { agent: "research", task: "x" });
    expect(res.error).toMatch(/depth limit/i);
  });

  it("reports an unknown agent", async () => {
    const t = ctx();
    const res = await run(t, { agent: "does-not-exist-xyz", task: "x" });
    expect(res.error).toMatch(/unknown agent/i);
  });

  it("propagates the session cwd + backend to the delegated specialist", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let received: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fakeBackend = { exec: async () => ({ stdout: "", stderr: "", code: 0 }) } as any;
    const t = ctx({
      cwd: "/session/folder",
      backend: fakeBackend,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      run: async (o: any) => {
        received = o;
        return { model: "mock", text: "ok", usage: undefined } as RunResult;
      },
    });
    await run(t, { agent: "research", task: "find things" });
    expect(received?.cwd).toBe("/session/folder"); // the specialist writes into the session folder
    expect(received?.backend).toBe(fakeBackend);
  });
});

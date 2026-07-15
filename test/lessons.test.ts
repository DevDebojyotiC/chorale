import { describe, it, expect, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { LessonStore } from "../src/core/lessons";
import { matchDiagnoses } from "../src/core/diagnose";

const DB = "data/test-lessons.sqlite";

describe("Phase 3 — self-learning lesson store", () => {
  const store = new LessonStore(DB);
  afterAll(() => {
    store.close();
    for (const ext of ["", "-wal", "-shm"]) { try { rmSync(DB + ext); } catch { /* ignore */ } }
  });

  it("records wins/uses and surfaces only proven lessons, best first", () => {
    store.record("coder", "port", "read process.env.PORT", true);
    store.record("coder", "port", "read process.env.PORT", true); // same lesson → increments
    store.record("coder", "template-literal", "serve HTML from a file", true);
    store.record("coder", "esm-cjs", "use import/export", false); // never won

    const top = store.top("coder", 6);
    expect(top.map((l) => l.key)).toEqual(["port", "template-literal"]); // esm-cjs excluded (0 wins)
    expect(top[0]?.uses).toBe(2);
    expect(top[0]?.wins).toBe(2);
  });

  it("prunes lessons that keep failing and never win", () => {
    store.record("coder", "delimiters", "balance brackets", false);
    store.record("coder", "delimiters", "balance brackets", false);
    store.record("coder", "delimiters", "balance brackets", false);
    expect(store.prune(3)).toBe(1); // uses=3, wins=0 → dropped
    expect(store.list("coder").some((l) => l.key === "delimiters")).toBe(false);
  });

  it("scopes lessons per agent", () => {
    store.record("research", "module-path", "fix the import path", true);
    expect(store.top("research").map((l) => l.key)).toEqual(["module-path"]);
    expect(store.top("coder").some((l) => l.key === "module-path")).toBe(false);
  });
});

describe("Phase 3 — diagnose category keys (learning keys)", () => {
  it("assigns stable keys used to index lessons", () => {
    expect(matchDiagnoses(['Syntax error "`" (line 5)']).map((d) => d.key)).toContain("template-literal");
    expect(matchDiagnoses(["listen EADDRINUSE :::3000"]).map((d) => d.key)).toContain("port");
    expect(matchDiagnoses(["require is not defined"]).map((d) => d.key)).toContain("esm-cjs");
    expect(matchDiagnoses(["totally novel error"])).toHaveLength(0);
  });

  it("every diagnose rule has a key", () => {
    // matchDiagnoses returns rules that all carry a key
    const keys = matchDiagnoses(["Cannot find module './x'", "foo is not defined"]).map((d) => d.key);
    expect(keys.every((k) => typeof k === "string" && k.length > 0)).toBe(true);
  });
});

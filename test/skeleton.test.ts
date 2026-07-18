import { describe, it, expect } from "vitest";
import { planSkeleton, parseDep, reconcileEnv, type SkeletonEdit } from "../src/core/skeleton";
import { versionFor, isDevPackage } from "../src/core/dependency-registry";
import { normalizeDesignContract } from "../src/core/design-contract";
import type { SourceFile } from "../src/core/contract";

const f = (path: string, content: string): SourceFile => ({ path, content });
const byPath = (edits: SkeletonEdit[]) => new Map(edits.map((e) => [e.path.replace(/\\/g, "/"), e]));
const manifest = (e: SkeletonEdit) => JSON.parse(e.content) as any;

describe("Phase 4 — dependency registry", () => {
  it("pins native modules to a prebuild-shipping major and falls back to latest for unknowns", () => {
    expect(versionFor("better-sqlite3")).toMatch(/\^1[2-9]/); // ^12+ ships Node-22 prebuilds
    expect(versionFor("express")).toMatch(/^\^4\./);
    expect(versionFor("some-obscure-pkg-xyz")).toBe("latest");
  });
  it("classifies types + tooling as dev packages", () => {
    expect(isDevPackage("@types/node")).toBe(true);
    expect(isDevPackage("tsx")).toBe(true);
    expect(isDevPackage("vitest")).toBe(true);
    expect(isDevPackage("express")).toBe(false);
  });
});

describe("Phase 4 — skeleton helpers", () => {
  it("parseDep splits name and explicit range, including scoped packages", () => {
    expect(parseDep("zod")).toEqual({ name: "zod" });
    expect(parseDep("zod@^3.24.1")).toEqual({ name: "zod", range: "^3.24.1" });
    expect(parseDep("@fastify/cors")).toEqual({ name: "@fastify/cors" });
    expect(parseDep("@fastify/cors@^10.0.2")).toEqual({ name: "@fastify/cors", range: "^10.0.2" });
  });

  it("reconcileEnv adds only missing vars and preserves existing values", () => {
    const r = reconcileEnv("PORT=3000\nJWT_SECRET=abc\n", ["PORT", "JWT_SECRET", "DATABASE_URL"]);
    expect(r.added).toEqual(["DATABASE_URL"]);
    expect(r.content).toContain("PORT=3000"); // untouched
    expect(r.content).toContain("JWT_SECRET=abc");
    expect(r.content).toMatch(/DATABASE_URL=\s*$/m);
  });

  it("reconcileEnv recognises `export VAR=` form and makes a header for a fresh file", () => {
    expect(reconcileEnv("export API_KEY=x\n", ["API_KEY"]).added).toEqual([]);
    const fresh = reconcileEnv("", ["PORT"]);
    expect(fresh.content).toMatch(/^#/); // header comment
    expect(fresh.content).toContain("PORT=");
  });
});

describe("Phase 4 — planSkeleton (deterministic skeleton, lever #2)", () => {
  it("creates a package.json when none exists, declaring imports + contract deps with real ranges", () => {
    const files = [
      f("src/index.ts", "import express from 'express';\nimport { z } from 'zod';\nimport { readFileSync } from 'node:fs';"),
    ];
    const contract = normalizeDesignContract({ dependencies: ["express", "jsonwebtoken"] });
    const edits = planSkeleton(files, contract);
    const pkg = manifest(byPath(edits).get("src/package.json")!);
    expect(pkg.type).toBe("module");
    expect(pkg.dependencies).toHaveProperty("express");
    expect(pkg.dependencies).toHaveProperty("zod"); // imported
    expect(pkg.dependencies).toHaveProperty("jsonwebtoken"); // contract-only
    expect(pkg.dependencies).not.toHaveProperty("fs"); // node builtin excluded
    // TS project → tsx/typescript/@types/node dev deps + a tsx start script
    expect(pkg.devDependencies).toHaveProperty("tsx");
    expect(pkg.devDependencies).toHaveProperty("typescript");
    expect(pkg.scripts.start).toMatch(/tsx/);
  });

  it("adds an imported-but-undeclared package to an existing manifest, bucketing @types to devDeps", () => {
    const files = [
      f("package.json", JSON.stringify({ name: "app", type: "module", dependencies: { express: "^4.21.2" } })),
      f("index.ts", "import express from 'express';\nimport jwt from 'jsonwebtoken';\nimport type { Foo } from '@types/whatever';"),
    ];
    const edits = planSkeleton(files, normalizeDesignContract({}));
    const pkg = manifest(byPath(edits).get("package.json")!);
    expect(pkg.dependencies).toHaveProperty("jsonwebtoken");
    expect(pkg.dependencies.express).toBe("^4.21.2"); // existing pin untouched
  });

  it("honours an explicit contract range over the curated pin", () => {
    const files = [f("index.js", "import Database from 'better-sqlite3';")];
    const edits = planSkeleton(files, normalizeDesignContract({ dependencies: ["better-sqlite3@^99.0.0"] }));
    const pkg = manifest(edits[0]!);
    expect(pkg.dependencies["better-sqlite3"]).toBe("^99.0.0");
  });

  it("does not touch a manifest that already declares everything imported", () => {
    const files = [
      f("package.json", JSON.stringify({ name: "app", dependencies: { express: "^4.21.2" } })),
      f("index.js", "import express from 'express';"),
    ];
    const edits = planSkeleton(files, normalizeDesignContract({}));
    expect(edits.filter((e) => e.path.endsWith("package.json"))).toHaveLength(0);
  });

  it("treats a package declared in ANY manifest as satisfied (lenient, like the check)", () => {
    const files = [
      f("package.json", JSON.stringify({ name: "root", dependencies: { zod: "^3.24.1" } })),
      f("backend/package.json", JSON.stringify({ name: "backend", dependencies: {} })),
      f("backend/index.ts", "import { z } from 'zod';"),
    ];
    const edits = planSkeleton(files, normalizeDesignContract({}));
    expect(edits.filter((e) => e.path.endsWith("package.json"))).toHaveLength(0); // zod already declared at root
  });

  it("attributes an imported package to the deepest owning manifest in a monorepo", () => {
    const files = [
      f("package.json", JSON.stringify({ name: "root", private: true })),
      f("backend/package.json", JSON.stringify({ name: "backend", dependencies: {} })),
      f("backend/src/server.ts", "import express from 'express';"),
    ];
    const edits = planSkeleton(files, normalizeDesignContract({}));
    const b = byPath(edits).get("backend/package.json");
    expect(b).toBeDefined(); // express lands in the backend unit, not root
    expect(manifest(b!).dependencies).toHaveProperty("express");
    expect(byPath(edits).has("package.json")).toBe(false);
  });

  it("writes a .env at the root with every contract env var, preserving an existing one", () => {
    const files = [
      f("package.json", JSON.stringify({ name: "app", dependencies: { express: "^4.21.2" } })),
      f(".env", "PORT=3000\n"),
      f("index.js", "import express from 'express';"),
    ];
    const edits = planSkeleton(files, normalizeDesignContract({ env: ["PORT", "JWT_SECRET"] }));
    const env = byPath(edits).get(".env")!;
    expect(env.content).toContain("PORT=3000");
    expect(env.content).toMatch(/JWT_SECRET=/);
  });

  it("produces no edits for an already-complete project", () => {
    const files = [
      f("package.json", JSON.stringify({ name: "app", type: "module", dependencies: { express: "^4.21.2" }, devDependencies: { tsx: "^4.19.2", typescript: "^5.7.3", "@types/node": "^22" } })),
      f(".env", "PORT=3000\n"),
      f("index.ts", "import express from 'express';"),
    ];
    const edits = planSkeleton(files, normalizeDesignContract({ dependencies: ["express"], env: ["PORT"] }));
    expect(edits).toEqual([]);
  });
});

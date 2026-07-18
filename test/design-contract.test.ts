import { describe, it, expect } from "vitest";
import { normalizeDesignContract, hasDesignContract, formatDesignContract, DESIGN_CONTRACT_SCHEMA, type DesignContract } from "../src/core/design-contract";

describe("Phase 4 — design contract (contract-first, lever #1)", () => {
  it("normalizes loose input: trims, collapses whitespace, dedupes, drops empties", () => {
    const c = normalizeDesignContract({
      endpoints: ["  POST   /api/login ", "POST   /api/login", "", "GET /notes"],
      modules: ["src/db.ts — exports db"],
      entities: ["users(id, email)"],
      dependencies: ["express", "express", " zod "],
      env: ["JWT_SECRET", ""],
    });
    expect(c.endpoints).toEqual(["POST /api/login", "GET /notes"]);
    expect(c.dependencies).toEqual(["express", "zod"]);
    expect(c.env).toEqual(["JWT_SECRET"]);
    expect(c.modules).toEqual(["src/db.ts — exports db"]);
    expect(c.entities).toEqual(["users(id, email)"]);
  });

  it("tolerates missing/garbage input (every field optional)", () => {
    const empty = normalizeDesignContract(undefined);
    expect(empty).toEqual({ endpoints: [], modules: [], entities: [], dependencies: [], env: [] });
    expect(normalizeDesignContract("nonsense")).toEqual(empty);
    expect(normalizeDesignContract({ endpoints: "not-an-array" }).endpoints).toEqual([]);
  });

  it("hasDesignContract is true only when at least one field carries content", () => {
    expect(hasDesignContract(undefined)).toBe(false);
    expect(hasDesignContract(null)).toBe(false);
    expect(hasDesignContract(normalizeDesignContract({}))).toBe(false);
    expect(hasDesignContract(normalizeDesignContract({ dependencies: ["express"] }))).toBe(true);
    expect(hasDesignContract(normalizeDesignContract({ env: ["PORT"] }))).toBe(true);
  });

  it("formats a full contract as an imperative single-source-of-truth block", () => {
    const c: DesignContract = {
      endpoints: ["POST /api/auth/login — body {email,password} → {token}"],
      modules: ["src/services/notes.ts — exports createNote(input), listNotes(userId)"],
      entities: ["users(id, email, passwordHash)"],
      dependencies: ["express", "jsonwebtoken", "better-sqlite3"],
      env: ["JWT_SECRET", "PORT"],
    };
    const out = formatDesignContract(c);
    expect(out).toMatch(/single source of truth/i);
    expect(out).toContain("POST /api/auth/login");
    expect(out).toContain("createNote(input)");
    expect(out).toContain("users(id, email, passwordHash)");
    expect(out).toContain("jsonwebtoken");
    expect(out).toContain("JWT_SECRET");
  });

  it("omits empty sections from the formatted block", () => {
    const out = formatDesignContract(normalizeDesignContract({ dependencies: ["express"] }));
    expect(out).toContain("Dependencies");
    expect(out).not.toMatch(/API endpoints/);
    expect(out).not.toMatch(/Env vars/);
  });

  it("the zod schema accepts a well-formed contract and a fully-empty one", () => {
    expect(DESIGN_CONTRACT_SCHEMA.safeParse({ endpoints: ["GET /x"], dependencies: ["express"] }).success).toBe(true);
    expect(DESIGN_CONTRACT_SCHEMA.safeParse({}).success).toBe(true);
  });
});

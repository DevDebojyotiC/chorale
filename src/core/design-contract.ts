/**
 * Design-time project contract (Phase 4 · contract-first · lever #1).
 *
 * The generated apps that don't run almost always fail at a BOUNDARY: the frontend calls a path the
 * backend never serves, a module imports an export a sibling never declared, code imports a package
 * package.json never lists, a handler reads an env var the .env never defines. Each file is generated
 * in isolation, so there is no shared source of truth for the seams between them — every producer and
 * consumer guesses at the other side and the guesses disagree.
 *
 * This module is that source of truth, produced UP FRONT by the planner (via the plan tool) and
 * threaded verbatim into EVERY build step: the exact REST surface, the module export signatures, the
 * data model, the required env vars, and the full dependency list. Where contract.ts (extractContract)
 * reads what was ALREADY built and reports it reactively, this declares what MUST be built before a
 * line of code exists — so a step's producer and its downstream consumer reference the same spec
 * instead of each other's guess.
 *
 * Pure and deterministic (normalize + format only); the model supplies the content.
 */

import { z } from "zod";

export interface DesignContract {
  /**
   * The exact REST surface, e.g. "POST /api/auth/login — body {email,password} → {token}". Every
   * route file that serves one of these AND every frontend call that hits one must match verbatim.
   */
  endpoints: string[];
  /**
   * Module boundaries, e.g. "src/services/notes.ts — exports createNote(input), listNotes(userId)".
   * Consumers import exactly these names/signatures; producers export exactly them.
   */
  modules: string[];
  /** The data model, e.g. "users(id, email, passwordHash, createdAt)". */
  entities: string[];
  /** Every npm package the app imports — so package.json declares all of them (kills missing-dependency). */
  dependencies: string[];
  /** Required env var names — so the .env template is complete and code reads the right keys. */
  env: string[];
}

/** Zod schema for the contract half of the plan tool. All optional: a plan without a contract is
 *  still a valid plan (backward compatible), and normalizeDesignContract fills the gaps. */
export const DESIGN_CONTRACT_SCHEMA = z
  .object({
    endpoints: z
      .array(z.string())
      .optional()
      .describe("Every HTTP endpoint as an EXACT method + path (with the real mount prefix), e.g. 'POST /api/auth/login — body {email,password} → {token}'. Route files and frontend calls must match these verbatim."),
    modules: z
      .array(z.string())
      .optional()
      .describe("Each shared module as 'path — exports name(args), name2(args)'. The names/signatures other steps import."),
    entities: z.array(z.string()).optional().describe("Data model: each table/entity as 'name(col1, col2, ...)'."),
    dependencies: z.array(z.string()).optional().describe("EVERY npm package the app imports (backend + frontend). package.json must declare all of them."),
    env: z.array(z.string()).optional().describe("Required environment variable names the code reads (e.g. JWT_SECRET, DATABASE_URL)."),
  })
  .describe("The interface contract: the exact seams (endpoints, module exports, data model, dependencies, env) every step must build against.");

const cleanList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? "").replace(/\s+/g, " ").trim()).filter(Boolean))] : [];

/** Canonicalize loosely-typed contract input (from the plan tool or JSON fallback) into a DesignContract. */
export function normalizeDesignContract(input: unknown): DesignContract {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    endpoints: cleanList(o.endpoints),
    modules: cleanList(o.modules),
    entities: cleanList(o.entities),
    dependencies: cleanList(o.dependencies),
    env: cleanList(o.env),
  };
}

/** True when the contract carries anything worth injecting. */
export function hasDesignContract(c: DesignContract | undefined | null): c is DesignContract {
  return Boolean(c) && (c!.endpoints.length > 0 || c!.modules.length > 0 || c!.entities.length > 0 || c!.dependencies.length > 0 || c!.env.length > 0);
}

/** Render the contract as a compact, imperative block injected verbatim into every build step. */
export function formatDesignContract(c: DesignContract): string {
  const lines: string[] = [
    "THE PROJECT CONTRACT — the single source of truth for the whole build. Every step builds to MATCH this EXACTLY; do NOT invent different routes, export names, packages, or env keys, and do NOT redesign the seams:",
  ];
  if (c.endpoints.length) lines.push("- API endpoints (exact method + path — every route file that serves one and every frontend fetch that calls one must match verbatim):\n" + c.endpoints.map((e) => `    ${e}`).join("\n"));
  if (c.modules.length) lines.push("- Module exports (import EXACTLY these names/signatures; do not rename or re-shape them):\n" + c.modules.map((m) => `    ${m}`).join("\n"));
  if (c.entities.length) lines.push("- Data model (use these EXACT table/column names): " + c.entities.join("; "));
  if (c.dependencies.length) lines.push("- Dependencies — package.json MUST declare every one; do NOT import a package outside this list without also adding it here: " + c.dependencies.join(", "));
  if (c.env.length) lines.push("- Env vars (read these EXACT names; the .env template defines them): " + c.env.join(", "));
  return lines.join("\n");
}

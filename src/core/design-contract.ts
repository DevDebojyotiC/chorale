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

// ── Per-step contract drift (lever #4) ────────────────────────────────────────

export interface EndpointDrift {
  /** What the step actually served, e.g. "POST /login". */
  served: string;
  /** The contract endpoint it should have matched, e.g. "POST /api/auth/login". */
  expected: string;
}

/** Parse "POST /api/x — notes" → {method, path}; null if it isn't a METHOD /path line. */
function parseMethodPath(s: string): { method: string; path: string } | null {
  const m = s.trim().match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i);
  return m ? { method: m[1]!.toUpperCase(), path: m[2]!.replace(/\/+$/, "") || "/" } : null;
}

/** The last non-parameter path segment (":id"/"*" ignored) — the stable identity of an endpoint. */
function lastConcreteSegment(path: string): string {
  const segs = path.split("/").filter((s) => s && !s.startsWith(":") && s !== "*" && !/^\$\{/.test(s));
  return segs.length ? segs[segs.length - 1]!.toLowerCase() : "";
}

/**
 * Detect endpoints a step SERVED that are a near-miss of a CONTRACT endpoint — same method and same
 * concluding resource, but a different full path (the classic "/login" vs "/api/auth/login" boundary
 * break). Only near-misses are reported: an endpoint that exactly matches the contract is fine, and one
 * with no contract sibling at all (e.g. a health check) is left alone — so this fires on drift from the
 * agreed spec, not on every path the contract didn't enumerate.
 */
export function contractDrift(served: string[], contract: DesignContract): EndpointDrift[] {
  const wanted = contract.endpoints.map(parseMethodPath).filter((x): x is { method: string; path: string } => x !== null);
  if (wanted.length === 0) return [];
  const wantedPaths = new Set(wanted.map((w) => `${w.method} ${w.path}`));
  const out: EndpointDrift[] = [];
  const seen = new Set<string>();
  for (const raw of served) {
    const s = parseMethodPath(raw.replace(/\s{2,}\(defined in.*$/, "")); // strip extractContract's note
    if (!s) continue;
    const key = `${s.method} ${s.path}`;
    if (wantedPaths.has(key) || seen.has(key)) continue; // exact match, or already reported
    const seg = lastConcreteSegment(s.path);
    if (!seg) continue;
    // A drift is a PREFIX difference on the same resource: one full path is a slash-anchored suffix of
    // the other (/login vs /api/auth/login), not merely two paths that happen to end in the same word
    // (/admin/users vs /api/users — different resources, left alone).
    const near = wanted.find((w) => w.method === s.method && lastConcreteSegment(w.path) === seg && w.path !== s.path && (w.path.endsWith("/" + s.path.replace(/^\//, "")) || s.path.endsWith("/" + w.path.replace(/^\//, ""))));
    if (near) {
      out.push({ served: key, expected: `${near.method} ${near.path}` });
      seen.add(key);
    }
  }
  return out;
}

/** A focused directive telling a step to align its drifted endpoints with the contract. */
export function driftDirective(drifts: EndpointDrift[]): string {
  return (
    "The endpoint(s) you served do NOT match the project contract — this breaks the frontend/consumer that calls the contract path. Use the EXACT contract path:\n" +
    drifts.map((d) => `  · you served "${d.served}" — the contract specifies "${d.expected}". Change it to the contract path.`).join("\n") +
    "\nRewrite the affected route/handler now so the served method+path matches the contract verbatim."
  );
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

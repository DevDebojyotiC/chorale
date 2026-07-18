/**
 * Workspace resolution + first-run seeding.
 *
 * In dev the app runs from the repo, so the workspace IS the repo cwd (its config/agents/.env are used
 * directly — nothing changes). In a PACKAGED app there is no project cwd, so the workspace is a
 * per-user directory (under Electron's userData) that we seed on first launch from the defaults bundled
 * with the app. After this, the core's cwd-relative reads (config, agents dir, .env, data/) all resolve
 * inside the workspace.
 *
 * No electron import here on purpose — main.ts injects the paths — so the seeding logic is unit-testable.
 */
import { existsSync, mkdirSync, cpSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The file whose presence means "already seeded". */
const MARKER = join("config", "chorale.config.json5");

/** True when `ws` still needs seeding (no config yet). */
export function needsSeed(ws: string): boolean {
  return !existsSync(join(ws, MARKER));
}

/**
 * Seed a fresh workspace from `defaultsDir` (which must contain config/ and agents/). Copies the config
 * and agent files, and creates a starter `.env` from `.env.example` if present. No-op when the
 * workspace already has a config, or when the defaults can't be found. Returns whether it seeded.
 */
export function firstRunSeed(ws: string, defaultsDir: string): boolean {
  if (!needsSeed(ws)) return false;
  const srcConfig = join(defaultsDir, "config");
  const srcAgents = join(defaultsDir, "agents");
  if (!existsSync(srcConfig) || !existsSync(srcAgents)) return false; // defaults missing — caller falls back
  mkdirSync(ws, { recursive: true });
  cpSync(srcConfig, join(ws, "config"), { recursive: true });
  cpSync(srcAgents, join(ws, "agents"), { recursive: true });
  // Skills are optional; copy if bundled.
  const srcSkills = join(defaultsDir, "skills");
  if (existsSync(srcSkills)) cpSync(srcSkills, join(ws, "skills"), { recursive: true });
  // Starter .env from the example (so provider-key slots exist to fill in the Settings UI).
  const envSeed = join(defaultsDir, ".env.example");
  const envDest = join(ws, ".env");
  if (existsSync(envSeed) && !existsSync(envDest)) copyFileSync(envSeed, envDest);
  return true;
}

/** Count of agent .md files in a workspace (excludes *.examples.md) — a quick sanity signal. */
export function agentCount(ws: string): number {
  try {
    return readdirSync(join(ws, "agents")).filter((f) => f.endsWith(".md") && !f.endsWith(".examples.md")).length;
  } catch {
    return 0;
  }
}

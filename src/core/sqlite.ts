import { createRequire } from "node:module";

/**
 * A thin better-sqlite3-compatible wrapper over Node's built-in **node:sqlite** (`DatabaseSync`).
 *
 * node:sqlite is part of Node itself — no native addon, no compiler, and ABI-agnostic, so it works in
 * plain Node AND inside Electron with no rebuild (which better-sqlite3 could not). session.ts and
 * lessons.ts only need to swap their import to this module; the API they use (`exec` / `prepare` /
 * `run().changes` / `get` / `all` with `?` params) is identical, and this adds the one method they use
 * that node:sqlite spells differently: `pragma()`.
 *
 * node:sqlite emits a one-time "experimental feature" warning when first loaded; we silence just that.
 */
const req = createRequire(import.meta.url);
const origEmit = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]): void => {
  const msg = typeof warning === "string" ? warning : warning?.message;
  if (typeof msg === "string" && msg.includes("SQLite is an experimental feature")) return;
  (origEmit as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
const { DatabaseSync } = req("node:sqlite") as typeof import("node:sqlite");
process.emitWarning = origEmit;

type DB = InstanceType<typeof DatabaseSync>;

/**
 * A prepared statement, typed like better-sqlite3's (get/all return `unknown` so callers cast to their
 * row type; `changes` is a plain number). node:sqlite's own types are stricter, so we loosen at the seam.
 */
export interface Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/** Minimal better-sqlite3-shaped Database, backed by node:sqlite. */
export default class Database {
  private db: DB;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }
  /** better-sqlite3's `pragma("journal_mode = WAL")` → node:sqlite runs it as a statement. */
  pragma(statement: string): void {
    this.db.exec(`PRAGMA ${statement}`);
  }
  exec(sql: string): this {
    this.db.exec(sql);
    return this;
  }
  prepare(sql: string): Statement {
    return this.db.prepare(sql) as unknown as Statement;
  }
  close(): void {
    this.db.close();
  }
}

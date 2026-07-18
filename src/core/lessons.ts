import Database from "./sqlite.js";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Self-learning store. When a diagnosed repair succeeds, the agent records the fix
 * that worked as a "lesson"; on future runs the top proven lessons are injected
 * proactively so the agent avoids the mistake *before* making it. This turns the
 * hand-written diagnose registry into a store the agent extends from experience.
 */
export interface Lesson {
  agent: string;
  key: string;
  lesson: string;
  uses: number;
  wins: number;
  updated_at: string;
}

const nowIso = (): string => new Date().toISOString();

export class LessonStore {
  private db: Database;

  constructor(path = process.env.CHORALE_LESSONS_DB || "data/lessons.sqlite") {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lessons (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        agent      TEXT NOT NULL,
        key        TEXT NOT NULL,
        lesson     TEXT NOT NULL,
        uses       INTEGER NOT NULL DEFAULT 0,
        wins       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(agent, key, lesson)
      );
      CREATE INDEX IF NOT EXISTS idx_lessons_agent ON lessons(agent);
    `);
  }

  /** Record that a lesson was surfaced during a repair, and whether that repair then succeeded. */
  record(agent: string, key: string, lesson: string, won: boolean): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO lessons (agent, key, lesson, uses, wins, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(agent, key, lesson) DO UPDATE SET uses = uses + 1, wins = wins + ?, updated_at = ?`,
      )
      .run(agent, key, lesson, won ? 1 : 0, now, now, won ? 1 : 0, now);
  }

  /** The agent's most useful proven lessons (won ≥ once), best first — for proactive injection. */
  top(agent: string, limit = 6): Lesson[] {
    return this.db
      .prepare(`SELECT agent, key, lesson, uses, wins, updated_at FROM lessons WHERE agent = ? AND wins > 0 ORDER BY wins DESC, updated_at DESC LIMIT ?`)
      .all(agent, limit) as Lesson[];
  }

  /** All lessons (optionally for one agent) — for the `chorale lessons` view. */
  list(agent?: string): Lesson[] {
    const stmt = this.db.prepare(
      `SELECT agent, key, lesson, uses, wins, updated_at FROM lessons ${agent ? "WHERE agent = ?" : ""} ORDER BY agent, wins DESC, uses DESC`,
    );
    return (agent ? stmt.all(agent) : stmt.all()) as Lesson[];
  }

  /** Drop lessons that keep being surfaced but never help (uses ≥ minUses, 0 wins). */
  prune(minUses = 3): number {
    return this.db.prepare(`DELETE FROM lessons WHERE wins = 0 AND uses >= ?`).run(minUses).changes;
  }

  close(): void {
    this.db.close();
  }
}

let singleton: LessonStore | null = null;
/** Lazily-opened process-wide lesson store (reused across a CLI turn incl. delegation). */
export function getLessonStore(): LessonStore {
  return (singleton ??= new LessonStore());
}
export function closeLessonStore(): void {
  singleton?.close();
  singleton = null;
}

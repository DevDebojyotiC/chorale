import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SessionRow {
  id: string;
  created_at: string;
  updated_at: string;
  agent: string;
  title: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Timestamped, sortable session id, e.g. 20260715_003148_a1b2c3. */
function newSessionId(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}_${randomBytes(3).toString("hex")}`;
}

/** SQLite-backed conversation store: create/resume/list sessions and their messages. */
export class SessionStore {
  private db: Database.Database;

  constructor(path = "data/chorale.sqlite") {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        agent      TEXT NOT NULL,
        title      TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        model      TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
    `);
  }

  createSession(agent: string): string {
    const id = newSessionId();
    const now = nowIso();
    this.db
      .prepare(`INSERT INTO sessions (id, created_at, updated_at, agent, title) VALUES (?, ?, ?, ?, NULL)`)
      .run(id, now, now, agent);
    return id;
  }

  getSession(id: string): SessionRow | undefined {
    return this.db.prepare(`SELECT id, created_at, updated_at, agent, title FROM sessions WHERE id = ?`).get(id) as
      | SessionRow
      | undefined;
  }

  latestSession(): SessionRow | undefined {
    return this.db
      .prepare(`SELECT id, created_at, updated_at, agent, title FROM sessions ORDER BY updated_at DESC LIMIT 1`)
      .get() as SessionRow | undefined;
  }

  listSessions(limit = 20): SessionRow[] {
    return this.db
      .prepare(`SELECT id, created_at, updated_at, agent, title FROM sessions ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as SessionRow[];
  }

  getMessages(sessionId: string): ChatMessage[] {
    return this.db
      .prepare(`SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC`)
      .all(sessionId) as ChatMessage[];
  }

  appendMessage(sessionId: string, role: ChatMessage["role"], content: string, model?: string): void {
    const now = nowIso();
    this.db
      .prepare(`INSERT INTO messages (session_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(sessionId, role, content, model ?? null, now);
    // Touch the session, and set a title from the first user message if unset.
    this.db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(now, sessionId);
    if (role === "user") {
      const title = content.replace(/\s+/g, " ").trim().slice(0, 60);
      this.db.prepare(`UPDATE sessions SET title = ? WHERE id = ? AND title IS NULL`).run(title, sessionId);
    }
  }

  close(): void {
    this.db.close();
  }
}

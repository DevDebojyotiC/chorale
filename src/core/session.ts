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

export interface UsageRow {
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
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
      CREATE TABLE IF NOT EXISTS usage (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id    TEXT NOT NULL,
        model         TEXT NOT NULL,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_session ON usage(session_id);
    `);
  }

  /** Record token usage for one turn (used by the `chorale cost` view). */
  recordUsage(sessionId: string, model: string, inputTokens: number, outputTokens: number): void {
    this.db
      .prepare(`INSERT INTO usage (session_id, model, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(sessionId, model, Math.max(0, inputTokens | 0), Math.max(0, outputTokens | 0), nowIso());
  }

  /** Aggregate usage per model (optionally scoped to one session). */
  usageByModel(sessionId?: string): UsageRow[] {
    const where = sessionId ? "WHERE session_id = ?" : "";
    const sql =
      `SELECT model, COUNT(*) AS requests, COALESCE(SUM(input_tokens),0) AS input_tokens, ` +
      `COALESCE(SUM(output_tokens),0) AS output_tokens FROM usage ${where} GROUP BY model ORDER BY output_tokens DESC`;
    const stmt = this.db.prepare(sql);
    return (sessionId ? stmt.all(sessionId) : stmt.all()) as UsageRow[];
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

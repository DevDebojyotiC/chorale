import { useEffect, useState } from "react";
import type { SessionInfo } from "../../shared/ipc";
import { chorale, agentColor } from "../bridge";

/** "3m ago" / "2h ago" / "5d ago" from an ISO timestamp. */
function ago(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function Sessions({ onOpen }: { onOpen: (session: SessionInfo) => void }) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    chorale.listSessions().then(setSessions);
  }, []);

  function rename(id: string, next: string) {
    const t = next.trim() || null;
    setEditing(null);
    setSessions((list) => list?.map((s) => (s.id === id ? { ...s, title: t } : s)) ?? list);
    void chorale.setSessionTitle(id, t);
  }

  if (!sessions) return <div className="loading">loading sessions…</div>;

  return (
    <div className="pad">
      <div className="pagehead">
        <h1>Sessions</h1>
        <p>Past conversations — pick one to resume it in Chat. Stored locally in the same SQLite the CLI uses.</p>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "1fr", maxWidth: 720 }}>
        {sessions.length === 0 && <div className="body user mono">No saved sessions yet — start chatting and they'll appear here.</div>}
        {sessions.map((s) => (
          <div key={s.id} className="card sessioncard" style={{ ["--acc" as string]: agentColor(s.agent) }} onClick={() => editing !== s.id && onOpen(s)} role="button" tabIndex={0}>
            <div className="ch">
              <span className="sw" />
              {editing === s.id ? (
                <input
                  className="titleedit grow"
                  autoFocus
                  defaultValue={s.title ?? ""}
                  placeholder="Name this session…"
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => rename(s.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      rename(s.id, (e.target as HTMLInputElement).value);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setEditing(null);
                    }
                  }}
                />
              ) : (
                <b>{s.title || "untitled conversation"}</b>
              )}
              <span className="tier">{s.agent}</span>
              <button
                className="renamebtn"
                title="Rename"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(s.id);
                }}
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            </div>
            <div className="kv">
              <span className="k">updated</span>
              <span className="val">{ago(s.updatedAt)}</span>
              {s.folder && (
                <span className="val" style={{ marginLeft: "auto", color: "var(--muted)" }} title={s.folder}>
                  📁 {s.folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop()}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

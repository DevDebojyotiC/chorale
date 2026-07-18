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

  useEffect(() => {
    chorale.listSessions().then(setSessions);
  }, []);

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
          <button key={s.id} className="card sessioncard" style={{ ["--acc" as string]: agentColor(s.agent), textAlign: "left", cursor: "pointer" }} onClick={() => onOpen(s)}>
            <div className="ch">
              <span className="sw" />
              <b>{s.title || "untitled conversation"}</b>
              <span className="tier">{s.agent}</span>
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
          </button>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import type { GitChange, GitStatus } from "../../shared/ipc";
import { chorale } from "../bridge";
import { CopyBtn } from "./Message";

const BADGE: Record<GitChange["status"], { c: string; v: string }> = {
  modified: { c: "var(--warn)", v: "M" },
  added: { c: "var(--ok)", v: "A" },
  untracked: { c: "var(--ok)", v: "U" },
  deleted: { c: "var(--crit)", v: "D" },
  renamed: { c: "var(--a-planner)", v: "R" },
  conflict: { c: "var(--crit)", v: "!" },
};

export function Changes({ folder, nonce, onOpen }: { folder: string; nonce: number; onOpen: (path: string) => void }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  useEffect(() => {
    setStatus(null);
    void chorale.gitStatus(folder).then(setStatus);
  }, [folder, nonce]);

  if (status === null) return <div className="empty">reading working tree…</div>;
  if (!status.repo) return <div className="empty">This folder isn't a git repository, so there's nothing to show.</div>;
  if (status.changes.length === 0) return <div className="empty">Working tree clean{status.branch ? ` on ${status.branch}` : ""}. No changes.</div>;

  return (
    <div className="changes">
      {status.branch && (
        <div className="changes-branch">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="8" r="2.5" /><path d="M18 10.5v.5a4 4 0 0 1-4 4H6M6 8.5v7" />
          </svg>
          {status.branch}
          <span className="changes-count">{status.changes.length}</span>
        </div>
      )}
      <div className="changelist">
        {status.changes.map((c) => {
          const b = BADGE[c.status];
          return (
            <button key={c.path} className="changerow" onClick={() => onOpen(c.path)} title={c.file}>
              <span className="cbadge" style={{ color: b.c, borderColor: b.c }}>{b.v}</span>
              <span className="cfile">{c.file}</span>
              {c.staged && <span className="cstaged" title="staged">●</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One rendered diff line, classified by its leading character. */
function diffClass(line: string): string {
  if (line.startsWith("@@")) return "dl hunk";
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) return "dl meta";
  if (line.startsWith("+")) return "dl add";
  if (line.startsWith("-")) return "dl del";
  return "dl ctx";
}

export function DiffModal({ folder, path, onClose }: { folder: string; path: string; onClose: () => void }) {
  const [diff, setDiff] = useState<string | null>(null);
  useEffect(() => {
    setDiff(null);
    void chorale.gitDiff(folder, path).then(setDiff);
  }, [folder, path]);
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
  const lines = diff ? diff.replace(/\n$/, "").split("\n") : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal filepreview" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="editor-h">
          <b>{name}</b>
          <span className="editor-sub mono">{path}</span>
          <div className="spacer" />
          {diff && <CopyBtn getText={() => diff} className="msgact" />}
          <button className="tbtn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="preview-body">
          {diff === null && <div className="loading">loading diff…</div>}
          {diff !== null && lines.length === 0 && <div className="empty">No diff vs HEAD.</div>}
          {lines.length > 0 && (
            <pre className="diff">
              {lines.map((l, i) => (
                <div className={diffClass(l)} key={i}>
                  {l || " "}
                </div>
              ))}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

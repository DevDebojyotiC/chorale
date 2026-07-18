import { useEffect, useState } from "react";
import type { PermissionReq } from "../../shared/ipc";
import { chorale } from "../bridge";

/** Shows a modal when an agent asks to run a shell command (auto-edit mode). Queues concurrent asks. */
export function PermissionModal() {
  const [queue, setQueue] = useState<PermissionReq[]>([]);

  useEffect(() => chorale.onPermission((req) => setQueue((q) => [...q, req])), []);

  const cur = queue[0];
  if (!cur) return null;

  const decide = (approved: boolean) => {
    chorale.respondPermission(cur.id, approved);
    setQueue((q) => q.slice(1));
  };

  return (
    <div className="modal-backdrop" onClick={() => decide(false)}>
      <div className="modal perm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="perm-h">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--warn)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 6l-5 6 5 6M16 6l5 6-5 6" />
          </svg>
          Run shell command?
        </div>
        <div className="perm-cmd mono">
          <span className="prompt">$</span> {cur.command}
        </div>
        <p className="perm-note">An agent wants to run this in your workspace. Approve only if you trust it.</p>
        <div className="perm-actions">
          <button className="btn" onClick={() => decide(false)}>
            Deny
          </button>
          <button className="btn primary" onClick={() => decide(true)} autoFocus>
            Approve &amp; run
          </button>
        </div>
      </div>
    </div>
  );
}

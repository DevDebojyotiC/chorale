import { useEffect, useState } from "react";
import type { DirEntry, RemoteHost } from "../../shared/ipc";
import { chorale } from "../bridge";

/** Split an ssh:// URI into its host id and absolute path. */
function parse(uri: string): { hostId: string; path: string } {
  const rest = uri.slice("ssh://".length);
  const slash = rest.indexOf("/");
  return slash < 0 ? { hostId: rest, path: "/" } : { hostId: rest.slice(0, slash), path: rest.slice(slash) || "/" };
}
function parentUri(uri: string): string | null {
  const { hostId, path } = parse(uri);
  if (path === "/" || path === "") return null;
  const up = path.slice(0, path.replace(/\/+$/, "").lastIndexOf("/")) || "/";
  return `ssh://${hostId}${up}`;
}

export function RemoteFolderPicker({ onPick, onClose }: { onPick: (uri: string) => void; onClose: () => void }) {
  const [hosts, setHosts] = useState<RemoteHost[] | null>(null);
  const [cur, setCur] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    chorale.remoteHosts().then(setHosts);
  }, []);
  useEffect(() => {
    if (!cur) return;
    setEntries(null);
    void chorale.readDir(cur).then((e) => setEntries(e.filter((x) => x.type === "dir")));
  }, [cur]);

  async function openHost(h: RemoteHost) {
    setCur(await chorale.remoteHomeUri(h.id));
  }

  const curPath = cur ? parse(cur).path : "";
  const up = cur ? parentUri(cur) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal remotepicker" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="editor-h">
          <b>{cur ? "Choose a remote folder" : "Choose a remote host"}</b>
          {cur && <span className="editor-sub mono">{curPath}</span>}
          <div className="spacer" />
          <button className="tbtn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {!cur ? (
          <div className="rp-body">
            {hosts === null && <div className="empty">loading hosts…</div>}
            {hosts?.length === 0 && <div className="empty">No hosts yet. Add one in Remote hosts.</div>}
            {hosts?.map((h) => (
              <button key={h.id} className="rp-host" onClick={() => openHost(h)}>
                <b>{h.label}</b>
                <span className="mono">
                  {h.username}@{h.host}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="rp-body">
              <button className="rp-row up" onClick={() => setCur(up)} disabled={!up}>
                <span className="tcaret">↑</span> ..
              </button>
              {entries === null && <div className="empty">reading…</div>}
              {entries?.length === 0 && <div className="empty">(no subfolders)</div>}
              {entries?.map((e) => (
                <button key={e.path} className="rp-row" onClick={() => setCur(e.path)} title={e.name}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--brand)" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                  </svg>
                  {e.name}
                </button>
              ))}
            </div>
            <div className="editor-actions">
              <button className="btn primary" onClick={() => onPick(cur)}>
                Use this folder
              </button>
              <button className="btn" onClick={() => setCur(null)}>
                ← hosts
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

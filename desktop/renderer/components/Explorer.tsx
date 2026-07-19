import { useEffect, useState } from "react";
import type { DirEntry, FilePreview } from "../../shared/ipc";
import { chorale } from "../bridge";
import { Message, CopyBtn } from "./Message";

const EXT_LANG: Record<string, string> = { ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript", json: "json", json5: "json", md: "markdown", css: "css", scss: "scss", html: "html", py: "python", rs: "rust", go: "go", sh: "bash", yml: "yaml", yaml: "yaml", sql: "sql", toml: "ini", env: "bash" };
const langOf = (name: string): string => EXT_LANG[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? "";

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--brand)" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {open ? <path d="M3 8h18l-2 10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm0 0V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2" /> : <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />}
    </svg>
  );
}
function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--faint)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    </svg>
  );
}

function TreeNode({ entry, depth, onOpen, active }: { entry: DirEntry; depth: number; onOpen: (p: string) => void; active: string | null }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const toggle = () => {
    if (entry.type !== "dir") return onOpen(entry.path);
    const next = !open;
    setOpen(next);
    if (next && children === null) void chorale.readDir(entry.path).then(setChildren);
  };
  return (
    <>
      <button className={"treenode" + (active === entry.path ? " on" : "")} style={{ paddingLeft: 8 + depth * 12 }} onClick={toggle} title={entry.name}>
        <span className="tcaret">{entry.type === "dir" ? (open ? "▾" : "▸") : ""}</span>
        {entry.type === "dir" ? <FolderIcon open={open} /> : <FileIcon />}
        <span className="tname">{entry.name}</span>
      </button>
      {open && children?.map((c) => <TreeNode key={c.path} entry={c} depth={depth + 1} onOpen={onOpen} active={active} />)}
    </>
  );
}

export function Explorer({ folder, onOpen, active }: { folder: string; onOpen: (p: string) => void; active: string | null }) {
  const [roots, setRoots] = useState<DirEntry[] | null>(null);
  useEffect(() => {
    setRoots(null);
    void chorale.readDir(folder).then(setRoots);
  }, [folder]);
  return (
    <aside className="explorer">
      <div className="explorer-h">
        <span>explorer</span>
        <span className="epath" title={folder}>
          {folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop()}
        </span>
      </div>
      <div className="tree">
        {roots === null && <div className="empty">loading…</div>}
        {roots?.length === 0 && <div className="empty">empty folder</div>}
        {roots?.map((e) => <TreeNode key={e.path} entry={e} depth={0} onOpen={onOpen} active={active} />)}
      </div>
    </aside>
  );
}

export function FilePreviewModal({ path, onClose }: { path: string; onClose: () => void }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  useEffect(() => {
    setPreview(null);
    void chorale.readFile(path).then(setPreview);
  }, [path]);
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal filepreview" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="editor-h">
          <b>{name}</b>
          <span className="editor-sub mono">{path}</span>
          <div className="spacer" />
          {preview?.kind === "text" && <CopyBtn getText={() => preview.content} className="msgact" />}
          <button className="tbtn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="preview-body">
          {!preview && <div className="loading">loading…</div>}
          {preview?.kind === "text" && <Message text={"```" + langOf(name) + "\n" + preview.content + "\n```"} markdown />}
          {preview?.kind === "image" && <img className="preview-img" src={preview.content} alt={name} />}
          {preview && ["binary", "toobig", "error"].includes(preview.kind) && <div className="empty">{preview.content}</div>}
        </div>
      </div>
    </div>
  );
}

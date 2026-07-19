import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentSummary, FileRef, PermissionMode } from "../../shared/ipc";
import { chorale, agentColor, eventStyle } from "../bridge";
import { Message, CopyBtn } from "../components/Message";
import { Explorer, FilePreviewModal } from "../components/Explorer";
import { Changes, DiffModal } from "../components/Changes";
import { fuzzyScore } from "../components/CommandPalette";
import { RemoteFolderPicker } from "../components/RemoteFolderPicker";

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3" />
    </svg>
  );
}

interface Attachment {
  path: string;
  name: string;
}
interface Turn {
  role: "user" | "assistant";
  text: string;
  agent?: string;
  model?: string;
  /** File names attached to a user turn (shown as chips under the message). */
  attachments?: string[];
}
interface Ev {
  type: string;
  text: string;
}

export function Chat({ resume, onResumed }: { resume?: { id: string; folder: string | null; title: string | null } | null; onResumed?: () => void }) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agent, setAgent] = useState("orchestrator");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState("");
  const [events, setEvents] = useState<Ev[]>([]);
  const [usage, setUsage] = useState<{ in: number; out: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<PermissionMode>("auto-edit");
  const [sessionId, setSessionId] = useState("");
  const [title, setTitle] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [folderMenu, setFolderMenu] = useState(false);
  const [remotePicker, setRemotePicker] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [railTab, setRailTab] = useState<"activity" | "changes">("activity");
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [changesNonce, setChangesNonce] = useState(0);
  const [slashSel, setSlashSel] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fileList, setFileList] = useState<FileRef[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    chorale.listAgents().then((a) => {
      setAgents(a);
      const def = a.some((x) => x.name === "orchestrator") ? "orchestrator" : (a[0]?.name ?? "general");
      setAgent(def);
      chorale.newSession(def).then(setSessionId);
    });
  }, []);

  function newChat() {
    setTurns([]);
    setEvents([]);
    setStreaming("");
    setUsage(null);
    setAttachments([]);
    setTitle(null);
    chorale.newSession(agent, folder).then(setSessionId); // keep the same project folder
  }

  function renameSession(next: string) {
    const t = next.trim() || null;
    setTitle(t);
    setEditingTitle(false);
    if (sessionId) void chorale.setSessionTitle(sessionId, t);
  }

  async function chooseFolder() {
    const f = await chorale.pickFolder();
    if (f === null) return;
    setFolder(f);
    setShowFiles(true);
    if (sessionId) void chorale.setSessionFolder(sessionId, f);
  }

  function clearFolder() {
    setFolder(null);
    setShowFiles(false);
    setPreviewPath(null);
    setDiffPath(null);
    setRailTab("activity");
    if (sessionId) void chorale.setSessionFolder(sessionId, null);
  }

  // Load a flat file list of the session folder for @-mentions (refreshed as the tree changes).
  useEffect(() => {
    if (!folder) {
      setFileList([]);
      return;
    }
    void chorale.listFiles(folder).then(setFileList);
  }, [folder, changesNonce]);

  function addAttachment(path: string, name?: string) {
    setAttachments((a) => (a.some((x) => x.path === path) ? a : [...a, { path, name: name ?? path.replace(/[\\/]+$/, "").split(/[\\/]/).pop()! }]));
  }
  function removeAttachment(path: string) {
    setAttachments((a) => a.filter((x) => x.path !== path));
  }
  async function attachFiles() {
    const paths = await chorale.pickFiles();
    for (const p of paths) addAttachment(p);
  }

  function pickRemoteFolder(uri: string) {
    setRemotePicker(false);
    setFolder(uri);
    setShowFiles(true);
    if (sessionId) void chorale.setSessionFolder(sessionId, uri);
  }

  // Resume a past session picked in the Sessions view: load its turns, id, and project folder.
  useEffect(() => {
    if (!resume) return;
    chorale.loadSession(resume.id).then((prior) => {
      setTurns(prior.map((t) => ({ role: t.role, text: t.content, agent: t.role === "assistant" ? agent : undefined })));
      setSessionId(resume.id);
      setFolder(resume.folder);
      setTitle(resume.title);
      setStreaming("");
      setEvents([]);
      setUsage(null);
      setAttachments([]);
      onResumed?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, streaming, events]);

  function submit() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy) return;
    setInput("");
    const attach = attachments;
    setAttachments([]);
    void submitText(text, turns, attach);
  }

  /** Retry the assistant turn at index i by re-running its preceding user prompt. */
  function retry(i: number) {
    const user = turns[i - 1];
    if (busy || !user || user.role !== "user") return;
    void submitText(user.text, turns.slice(0, i - 1));
  }

  /** Read the attached files and wrap their text as a context preamble for the agent. */
  async function buildPrompt(text: string, attach: Attachment[]): Promise<string> {
    if (attach.length === 0) return text;
    const blocks: string[] = [];
    for (const a of attach) {
      const pv = await chorale.readFile(a.path);
      blocks.push(pv.kind === "text" ? `<file path="${a.name}">\n${pv.content}\n</file>` : `<file path="${a.name}">(${pv.kind} — not included)</file>`);
    }
    const preamble = `The user attached these files for context:\n\n${blocks.join("\n\n")}`;
    return text ? `${preamble}\n\n---\n\n${text}` : preamble;
  }

  async function submitText(text: string, base: Turn[], attach: Attachment[] = []) {
    if ((!text && attach.length === 0) || busy) return;
    // Auto-title a fresh, untitled session from its first prompt.
    if (base.length === 0 && !title && text) {
      const auto = text.replace(/\s+/g, " ").trim().slice(0, 48);
      setTitle(auto);
      if (sessionId) void chorale.setSessionTitle(sessionId, auto);
    }
    setTurns([...base, { role: "user", text, attachments: attach.length ? attach.map((a) => a.name) : undefined }]);
    setBusy(true);
    setStreaming("");
    setEvents([]);
    setUsage(null);
    const history = base.map((t) => ({ role: t.role, content: t.text }));
    const prompt = await buildPrompt(text, attach);
    let acc = "";
    cancelRef.current = chorale.run({ agent, prompt, sessionId, history, permissionMode: mode, folder }, {
      onToken: (tk) => {
        acc += tk;
        setStreaming(acc);
      },
      onEvent: (type, txt) => setEvents((e) => [...e, { type, text: txt }]),
      onDone: (model, final, u) => {
        cancelRef.current = null;
        setTurns((t) => [...t, { role: "assistant", text: final || acc, agent, model }]);
        setStreaming("");
        setUsage(u ? { in: u.inputTokens, out: u.outputTokens } : null);
        setBusy(false);
        setChangesNonce((n) => n + 1); // the run may have edited files — refresh the changes panel
      },
      onError: (msg) => {
        cancelRef.current = null;
        setTurns((t) => [...t, { role: "assistant", text: "⚠ " + msg, agent, model: "error" }]);
        setStreaming("");
        setBusy(false);
      },
    });
  }

  function stop() {
    cancelRef.current?.();
    cancelRef.current = null;
    setStreaming((partial) => {
      if (partial) setTurns((t) => [...t, { role: "assistant", text: partial + " …(stopped)", agent }]);
      return "";
    });
    setBusy(false);
  }

  // Slash commands — typed in the composer, they act on chat state instead of sending a message.
  interface SlashCmd {
    id: string;
    label: string;
    hint?: string;
    run: () => void;
  }
  const slashCommands: SlashCmd[] = [
    { id: "new", label: "/new", hint: "start a new conversation", run: newChat },
    { id: "folder", label: "/folder", hint: "choose a project folder", run: () => void chooseFolder() },
    { id: "read-only", label: "/read-only", hint: "mode → read-only", run: () => setMode("read-only") },
    { id: "auto-edit", label: "/auto-edit", hint: "mode → auto-edit", run: () => setMode("auto-edit") },
    { id: "full-auto", label: "/full-auto", hint: "mode → full-auto", run: () => setMode("full-auto") },
    ...(folder
      ? [
          { id: "files", label: "/files", hint: "toggle the file explorer", run: () => setShowFiles((v) => !v) },
          { id: "changes", label: "/changes", hint: "show changed files", run: () => setRailTab("changes") },
          { id: "clear-folder", label: "/clear-folder", hint: "use the default workspace", run: clearFolder },
        ]
      : []),
    ...agents.map((a) => ({ id: `agent-${a.name}`, label: `/${a.name}`, hint: `switch to the ${a.name} agent`, run: () => setAgent(a.name) })),
  ];
  interface MenuItem {
    key: string;
    label: string;
    hint?: string;
    run: () => void;
  }
  const slashOpen = input.startsWith("/");
  // @-mention: the trailing @word (when not a slash command and a folder is set).
  const mentionMatch = !slashOpen && folder ? input.match(/(?:^|\s)@([\w./\\-]*)$/) : null;

  const menuItems = useMemo<MenuItem[]>(() => {
    if (slashOpen) {
      const q = input.slice(1).toLowerCase();
      return slashCommands
        .map((c) => ({ c, s: fuzzyScore(c.label.slice(1) + " " + (c.hint ?? ""), q) }))
        .filter((x): x is { c: SlashCmd; s: number } => x.s !== null)
        .sort((a, b) => b.s - a.s)
        .map((x) => ({ key: x.c.id, label: x.c.label, hint: x.c.hint, run: () => runSlash(x.c) }));
    }
    if (mentionMatch) {
      const q = mentionMatch[1]!.toLowerCase();
      return fileList
        .map((f) => ({ f, s: fuzzyScore(f.rel, q) }))
        .filter((x): x is { f: FileRef; s: number } => x.s !== null)
        .sort((a, b) => b.s - a.s)
        .slice(0, 8)
        .map((x) => ({ key: x.f.path, label: "@" + x.f.rel, hint: "attach", run: () => applyMention(x.f) }));
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, folder, agents, fileList]);

  const menuOpen = menuItems.length > 0;
  const menuIdx = Math.min(slashSel, menuItems.length - 1);
  useEffect(() => setSlashSel(0), [input]);

  function runSlash(cmd: SlashCmd | undefined) {
    if (!cmd) return;
    setInput("");
    cmd.run();
  }
  function applyMention(f: FileRef) {
    setInput((cur) => cur.replace(/(^|\s)@[\w./\\-]*$/, (_m, lead: string) => lead)); // drop the @word, keep the leading space
    addAttachment(f.path, f.rel);
  }

  const explorerOpen = showFiles && !!folder;

  return (
    <div className={"chat" + (explorerOpen ? " with-explorer" : "")}>
      {explorerOpen && folder && <Explorer folder={folder} onOpen={setPreviewPath} active={previewPath} />}
      {previewPath && <FilePreviewModal path={previewPath} onClose={() => setPreviewPath(null)} />}
      {diffPath && folder && <DiffModal folder={folder} path={diffPath} onClose={() => setDiffPath(null)} />}
      {remotePicker && <RemoteFolderPicker onPick={pickRemoteFolder} onClose={() => setRemotePicker(false)} />}
      <div className="thread">
        <div className="thread-inner">
          <div className="agentbar">
            {editingTitle ? (
              <input
                className="titleedit"
                autoFocus
                defaultValue={title ?? ""}
                placeholder="Name this session…"
                onBlur={(e) => renameSession(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    renameSession((e.target as HTMLInputElement).value);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingTitle(false);
                  }
                }}
              />
            ) : (
              <button className="titlechip" onClick={() => setEditingTitle(true)} title="Rename this session">
                <span className={"titletext" + (title ? "" : " muted")}>{title ?? "untitled session"}</span>
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            )}
            <div className="agentbar-sep" />
            {agents.map((a) => (
              <button key={a.name} className="apill" data-on={a.name === agent ? "1" : "0"} style={{ ["--acc" as string]: agentColor(a.name) }} onClick={() => setAgent(a.name)} title={a.description}>
                <span className="sw" style={{ background: agentColor(a.name) }} />
                {a.name}
              </button>
            ))}
            <div className="spacer" />
            {folder && (
              <button className="filestoggle" data-on={showFiles ? "1" : "0"} onClick={() => setShowFiles((v) => !v)} title={showFiles ? "Hide the file explorer" : "Show the file explorer"}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                  <path d="M9 3v16" />
                </svg>
                files
              </button>
            )}
            <div className="folderwrap">
              <button className="folderchip" onClick={() => setFolderMenu((v) => !v)} title={folder ?? "Choose where the agent works — local or remote"}>
                {folder && folder.startsWith("ssh://") ? (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="12" rx="2" />
                    <path d="M8 20h8M12 16v4" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                  </svg>
                )}
                {folder ? folder.replace(/\/+$/, "").split(/[\\/]/).pop() || "workspace" : "workspace"}
                {folder && (
                  <span
                    className="clearfolder"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearFolder();
                    }}
                    title="Use the default workspace"
                  >
                    ✕
                  </span>
                )}
                <span className="chipcaret">▾</span>
              </button>
              {folderMenu && (
                <div className="foldermenu">
                  <button
                    onClick={() => {
                      setFolderMenu(false);
                      void chooseFolder();
                    }}
                  >
                    Local folder…
                  </button>
                  <button
                    onClick={() => {
                      setFolderMenu(false);
                      setRemotePicker(true);
                    }}
                  >
                    Remote host…
                  </button>
                </div>
              )}
            </div>
            <select className="modesel" value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)} title="What the agent may do this turn">
              <option value="read-only">read-only</option>
              <option value="auto-edit">auto-edit</option>
              <option value="full-auto">full-auto</option>
            </select>
            {turns.length > 0 && (
              <button className="apill newchat" onClick={newChat} disabled={busy} title="Start a new conversation">
                ＋ new chat
              </button>
            )}
          </div>

          {turns.length === 0 && !busy && <div className="body user">Ask the chorale anything — the <b>{agent}</b> agent will take it{agent === "orchestrator" ? ", decomposing and delegating as needed." : "."}</div>}

          {turns.map((t, i) => (
            <div className="msg" key={i}>
              <div className="who">
                <span className="sw" style={{ background: t.role === "user" ? "var(--a-general)" : agentColor(t.agent ?? "") }} />
                <b style={{ color: t.role === "user" ? undefined : agentColor(t.agent ?? "") }}>{t.role === "user" ? "you" : t.agent}</b>
                {t.model && <span className="meta">{t.model}</span>}
                <div className="msg-actions">
                  <CopyBtn getText={() => t.text} label="copy" className="msgact" />
                  {t.role === "assistant" && (
                    <button className="msgact" onClick={() => retry(i)} disabled={busy}>
                      retry
                    </button>
                  )}
                </div>
              </div>
              {t.text && (t.role === "assistant" ? <Message text={t.text} markdown /> : <Message text={t.text} markdown={false} />)}
              {t.attachments && t.attachments.length > 0 && (
                <div className="attach-row in-msg">
                  {t.attachments.map((n) => (
                    <span className="attach-chip" key={n} title={n}>
                      <PaperclipIcon />
                      {n}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="msg">
              <div className="who">
                <span className="sw" style={{ background: agentColor(agent) }} />
                <b style={{ color: agentColor(agent) }}>{agent}</b>
                <span className="meta">working…</span>
              </div>
              <div className="body">
                {streaming}
                <span className="caret" />
              </div>
            </div>
          )}
          <div ref={bottom} />
        </div>

        <div className="composer-wrap">
          {menuOpen && (
            <div className="slashmenu">
              {menuItems.map((it, i) => (
                <button key={it.key} className="slashitem" data-sel={i === menuIdx ? "1" : "0"} onMouseMove={() => setSlashSel(i)} onClick={it.run}>
                  <span className="slashlabel">{it.label}</span>
                  {it.hint && <span className="slashhint">{it.hint}</span>}
                </button>
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="attach-row pending">
              {attachments.map((a) => (
                <span className="attach-chip removable" key={a.path} onClick={() => setPreviewPath(a.path)} title={a.path}>
                  <PaperclipIcon />
                  {a.name}
                  <span
                    className="attach-x"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAttachment(a.path);
                    }}
                    aria-label="Remove attachment"
                  >
                    ✕
                  </span>
                </span>
              ))}
            </div>
          )}
          <div
            className="box"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              for (const f of Array.from(e.dataTransfer.files)) {
                const p = (f as File & { path?: string }).path;
                if (p) addAttachment(p);
              }
            }}
          >
            {folder && (
              <button className="clip" onClick={attachFiles} title="Attach files" aria-label="Attach files">
                <PaperclipIcon />
              </button>
            )}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (menuOpen) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashSel((s) => Math.min(s + 1, menuItems.length - 1));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashSel((s) => Math.max(s - 1, 0));
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    if (slashOpen) setInput("");
                    else setInput((cur) => cur.replace(/(^|\s)@[\w./\\-]*$/, (_m, lead: string) => lead));
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    menuItems[menuIdx]?.run();
                    return;
                  }
                  if (e.key === "Tab" && slashOpen) {
                    e.preventDefault();
                    setInput(menuItems[menuIdx]!.label + " ");
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={busy ? "the chorale is working…" : `Message ${agent} — Enter to send · / commands · @ files`}
              rows={1}
            />
            {busy ? (
              <button className="send stop" onClick={stop} aria-label="Stop" title="Stop">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button className="send" onClick={submit} disabled={!input.trim() && attachments.length === 0} aria-label="Send">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 11l5-5 5 5M12 6v13" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <aside className="rail">
        <div className="railtabs">
          <button className="railtab" data-on={railTab === "activity" ? "1" : "0"} onClick={() => setRailTab("activity")}>
            <span className={"live" + (busy ? " on" : "")} />
            activity
          </button>
          {folder && (
            <button className="railtab" data-on={railTab === "changes" ? "1" : "0"} onClick={() => setRailTab("changes")}>
              changes
            </button>
          )}
          {railTab === "changes" && folder && (
            <button className="railrefresh" onClick={() => setChangesNonce((n) => n + 1)} title="Refresh changes">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 11a8 8 0 1 0-.5 3M20 5v6h-6" />
              </svg>
            </button>
          )}
        </div>
        {railTab === "activity" ? (
          <div className="events">
            {events.length === 0 && <div className="empty">{busy ? "listening…" : "Activity from the run — tool calls, verify, escalation — appears here."}</div>}
            {events.map((ev, i) => {
              const st = eventStyle(ev.type);
              return (
                <div className="ev" key={i} style={{ ["--acc" as string]: st.color }}>
                  <span className="ico">
                    <span className="dotc" />
                  </span>
                  <div className="txt">
                    <span className="h">{ev.text}</span>
                    <span className="tag">{st.tag}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="events">{folder && <Changes folder={folder} nonce={changesNonce} onOpen={setDiffPath} />}</div>
        )}
        <div className="railfoot">
          <div className="stat">
            <div className="k">tokens</div>
            <div className="v">
              {usage ? (usage.in / 1000).toFixed(1) + "k" : "—"}
              <small> in</small> {usage ? (usage.out / 1000).toFixed(1) + "k" : "—"}
              <small> out</small>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

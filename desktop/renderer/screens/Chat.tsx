import { useEffect, useRef, useState } from "react";
import type { AgentSummary, PermissionMode } from "../../shared/ipc";
import { chorale, agentColor, eventStyle } from "../bridge";

interface Turn {
  role: "user" | "assistant";
  text: string;
  agent?: string;
  model?: string;
}
interface Ev {
  type: string;
  text: string;
}

export function Chat({ resume, onResumed }: { resume?: string | null; onResumed?: () => void }) {
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
    chorale.newSession(agent).then(setSessionId);
  }

  // Resume a past session picked in the Sessions view: load its turns and adopt its id.
  useEffect(() => {
    if (!resume) return;
    chorale.loadSession(resume).then((prior) => {
      setTurns(prior.map((t) => ({ role: t.role, text: t.content, agent: t.role === "assistant" ? agent : undefined })));
      setSessionId(resume);
      setStreaming("");
      setEvents([]);
      setUsage(null);
      onResumed?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, streaming, events]);

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setTurns((t) => [...t, { role: "user", text }]);
    setBusy(true);
    setStreaming("");
    setEvents([]);
    setUsage(null);
    const history = turns.map((t) => ({ role: t.role, content: t.text }));
    let acc = "";
    cancelRef.current = chorale.run({ agent, prompt: text, sessionId, history, permissionMode: mode }, {
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

  return (
    <div className="chat">
      <div className="thread">
        <div className="thread-inner">
          <div className="agentbar">
            {agents.map((a) => (
              <button key={a.name} className="apill" data-on={a.name === agent ? "1" : "0"} style={{ ["--acc" as string]: agentColor(a.name) }} onClick={() => setAgent(a.name)} title={a.description}>
                <span className="sw" style={{ background: agentColor(a.name) }} />
                {a.name}
              </button>
            ))}
            <div className="spacer" />
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
              </div>
              <div className={"body" + (t.role === "user" ? " user" : "")}>{t.text}</div>
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
          <div className="box">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={busy ? "the chorale is working…" : `Message ${agent} — Enter to send, Shift+Enter for a new line`}
              rows={1}
            />
            {busy ? (
              <button className="send stop" onClick={stop} aria-label="Stop" title="Stop">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button className="send" onClick={submit} disabled={!input.trim()} aria-label="Send">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 11l5-5 5 5M12 6v13" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <aside className="rail">
        <h3>
          <span className={"live" + (busy ? " on" : "")} />
          live activity
        </h3>
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

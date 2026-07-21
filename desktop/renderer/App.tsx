import { useEffect, useState, type ReactNode } from "react";
import { Chat } from "./screens/Chat";
import { Agents } from "./screens/Agents";
import { Settings } from "./screens/Settings";
import { Sessions } from "./screens/Sessions";
import { CostUsage } from "./screens/CostUsage";
import { Playbook } from "./screens/Playbook";
import { Doctor } from "./screens/Doctor";
import { PermissionModal } from "./components/PermissionModal";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { Resizer, initPanelWidths } from "./components/Resizer";
import { IS_MOCK, chorale } from "./bridge";

type Screen = "chat" | "agents" | "settings" | "sessions" | "cost" | "playbook" | "doctor";

const NAV: { id: Screen; label: string; key: string; icon: ReactNode }[] = [
  { id: "chat", label: "Chat", key: "1", icon: <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z" /> },
  { id: "agents", label: "Agents", key: "2", icon: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 6.2a3.2 3.2 0 0 1 0 6M20.5 20a5.5 5.5 0 0 0-4-5.3" /></> },
  { id: "settings", label: "Settings", key: "3", icon: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8M4.6 9a1.6 1.6 0 0 0-.3-1.8M9 4.6A1.6 1.6 0 0 0 10 3.5M14 3.5A1.6 1.6 0 0 0 15 4.6M20.5 10A1.6 1.6 0 0 0 21.5 11M2.5 13A1.6 1.6 0 0 0 3.5 14" /></> },
];

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>("chat");
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);
  const [resume, setResume] = useState<{ id: string; folder: string | null; title: string | null } | null>(null); // session to open in Chat
  const [workspace, setWorkspace] = useState("workspace");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newChatNonce, setNewChatNonce] = useState(0); // bump to start a fresh chat from the nav
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem("nav-collapsed") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    chorale.getAppInfo().then((i) => setWorkspace(i.workspace.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "workspace"));
    initPanelWidths({ "--nav-w": "216px", "--explorer-w": "250px", "--rail-w": "340px" });
  }, []);

  const toggleNav = () => {
    setNavCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("nav-collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    const effective = theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    // Blend the native window-controls overlay into the app's top bar.
    chorale.setTitleBarOverlay(...(effective === "dark" ? (["#0e1116", "#8b96a5"] as const) : (["#f4f6f8", "#5c6875"] as const)));
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        toggleNav();
        return;
      }
      if (e.target instanceof HTMLElement && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT")) return;
      if (e.key === "1") setScreen("chat");
      if (e.key === "2") setScreen("agents");
      if (e.key === "3") setScreen("settings");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleTheme = () => {
    const cur = theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(cur === "dark" ? "light" : "dark");
  };

  const paletteCommands: Command[] = [
    ...NAV.map((n) => ({ id: `go-${n.id}`, group: "Go to", label: n.label, hint: `⌘${n.key}`, run: () => setScreen(n.id) })),
    { id: "go-sessions", group: "Go to", label: "Sessions", run: () => setScreen("sessions") },
    { id: "go-cost", group: "Go to", label: "Cost & usage", run: () => setScreen("cost") },
    { id: "go-playbook", group: "Go to", label: "Playbook", run: () => setScreen("playbook") },
    { id: "go-doctor", group: "Go to", label: "Doctor", run: () => setScreen("doctor") },
    { id: "toggle-theme", group: "View", label: "Toggle light / dark theme", run: toggleTheme },
  ];

  return (
    <div className={"app" + (navCollapsed ? " nav-collapsed" : "")}>
      <div className="brand">
        <svg className="glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="2.5" y="9" width="3" height="6" rx="1.5" fill="var(--a-research)" />
          <rect x="7" y="5.5" width="3" height="13" rx="1.5" fill="var(--a-coder)" />
          <rect x="11.5" y="3" width="3" height="18" rx="1.5" fill="var(--brand)" />
          <rect x="16" y="6.5" width="3" height="11" rx="1.5" fill="var(--a-planner)" />
          <rect x="20.5" y="9.5" width="1.6" height="5" rx=".8" fill="var(--a-reviewer)" />
        </svg>
        <div className="brand-name">
          <b>Chorale</b> <span>console</span>
        </div>
        <button className="navtoggle" onClick={toggleNav} title={(navCollapsed ? "Expand" : "Collapse") + " sidebar (Ctrl+B)"} aria-label="Toggle sidebar">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>
      </div>

      <div className="top">
        <div className="crumb">
          workspace <b>{workspace}</b>
          {IS_MOCK && <span style={{ color: "var(--warn)" }}> · preview (mock data)</span>}
        </div>
        <div className="spacer" />
        <button className="cmdk" onClick={() => setPaletteOpen(true)} title="Command palette (Ctrl/⌘K)">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <span className="kbd">⌘K</span>
        </button>
        <button className="tbtn" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
          </svg>
        </button>
      </div>

      <nav>
        <button
          className="newchat-nav"
          onClick={() => {
            setScreen("chat");
            setNewChatNonce((n) => n + 1);
          }}
          title="Start a new conversation"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>New chat</span>
        </button>
        {NAV.map((n) => (
          <button key={n.id} className="navitem" aria-current={screen === n.id} onClick={() => setScreen(n.id)}>
            <Icon>{n.icon}</Icon>
            <span>{n.label}</span>
            <span className="kbd">{n.key}</span>
          </button>
        ))}
        <div className="navlabel">Observe</div>
        <button className="navitem" aria-current={screen === "sessions"} onClick={() => setScreen("sessions")}>
          <Icon><><path d="M4 19.5V5a2 2 0 0 1 2-2h11.5" /><path d="M6 17h13v3H6a2 2 0 0 1 0-4Z" /></></Icon>
          <span>Sessions</span>
        </button>
        <button className="navitem" aria-current={screen === "cost"} onClick={() => setScreen("cost")}>
          <Icon><><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></></Icon>
          <span>Cost &amp; usage</span>
        </button>
        <button className="navitem" aria-current={screen === "playbook"} onClick={() => setScreen("playbook")}>
          <Icon><><path d="M12 2l2.4 5 5.6.5-4.2 3.7 1.3 5.4L12 18.8 6.9 21.6l1.3-5.4L4 12.5 9.6 12Z" /></></Icon>
          <span>Playbook</span>
        </button>
        <button className="navitem" aria-current={screen === "doctor"} onClick={() => setScreen("doctor")}>
          <Icon><><path d="M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z" /><path d="M12 8v4l3 2" /></></Icon>
          <span>Doctor</span>
        </button>
        {!navCollapsed && <Resizer cssVar="--nav-w" min={176} max={340} dir={1} className="nav-resizer" />}
      </nav>

      <main>
        {screen === "chat" && <Chat resume={resume} onResumed={() => setResume(null)} newChatSignal={newChatNonce} />}
        {screen === "agents" && <Agents />}
        {screen === "settings" && <Settings />}
        {screen === "sessions" && (
          <Sessions
            onOpen={(s) => {
              setResume({ id: s.id, folder: s.folder, title: s.title });
              setScreen("chat");
            }}
          />
        )}
        {screen === "cost" && <CostUsage />}
        {screen === "playbook" && <Playbook />}
        {screen === "doctor" && <Doctor />}
      </main>
      <PermissionModal />
      {paletteOpen && <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

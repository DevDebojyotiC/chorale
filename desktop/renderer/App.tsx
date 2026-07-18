import { useEffect, useState, type ReactNode } from "react";
import { Chat } from "./screens/Chat";
import { Agents } from "./screens/Agents";
import { Config } from "./screens/Config";

type Screen = "chat" | "agents" | "config";

const NAV: { id: Screen; label: string; key: string; icon: ReactNode }[] = [
  { id: "chat", label: "Chat", key: "1", icon: <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z" /> },
  { id: "agents", label: "Agents", key: "2", icon: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 6.2a3.2 3.2 0 0 1 0 6M20.5 20a5.5 5.5 0 0 0-4-5.3" /></> },
  { id: "config", label: "Config", key: "3", icon: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8M4.6 9a1.6 1.6 0 0 0-.3-1.8M9 4.6A1.6 1.6 0 0 0 10 3.5M14 3.5A1.6 1.6 0 0 0 15 4.6M20.5 10A1.6 1.6 0 0 0 21.5 11M2.5 13A1.6 1.6 0 0 0 3.5 14" /></> },
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

  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT")) return;
      if (e.key === "1") setScreen("chat");
      if (e.key === "2") setScreen("agents");
      if (e.key === "3") setScreen("config");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleTheme = () => {
    const cur = theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(cur === "dark" ? "light" : "dark");
  };

  return (
    <div className="app">
      <div className="brand">
        <svg className="glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="2.5" y="9" width="3" height="6" rx="1.5" fill="var(--a-research)" />
          <rect x="7" y="5.5" width="3" height="13" rx="1.5" fill="var(--a-coder)" />
          <rect x="11.5" y="3" width="3" height="18" rx="1.5" fill="var(--brand)" />
          <rect x="16" y="6.5" width="3" height="11" rx="1.5" fill="var(--a-planner)" />
          <rect x="20.5" y="9.5" width="1.6" height="5" rx=".8" fill="var(--a-reviewer)" />
        </svg>
        <div>
          <b>Chorale</b> <span>console</span>
        </div>
      </div>

      <div className="top">
        <div className="crumb">
          workspace <b>swarm</b>
        </div>
        <div className="spacer" />
        <button className="tbtn" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
          </svg>
        </button>
      </div>

      <nav>
        {NAV.map((n) => (
          <button key={n.id} className="navitem" aria-current={screen === n.id} onClick={() => setScreen(n.id)}>
            <Icon>{n.icon}</Icon>
            <span>{n.label}</span>
            <span className="kbd">{n.key}</span>
          </button>
        ))}
        <div className="navlabel">Observe</div>
        <button className="navitem" disabled title="Coming soon">
          <Icon><><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></></Icon>
          <span>Cost &amp; usage</span>
        </button>
        <button className="navitem" disabled title="Coming soon">
          <Icon><><path d="M12 2l2.4 5 5.6.5-4.2 3.7 1.3 5.4L12 18.8 6.9 21.6l1.3-5.4L4 12.5 9.6 12Z" /></></Icon>
          <span>Playbook</span>
        </button>
      </nav>

      <main>
        {screen === "chat" && <Chat />}
        {screen === "agents" && <Agents />}
        {screen === "config" && <Config />}
      </main>
    </div>
  );
}

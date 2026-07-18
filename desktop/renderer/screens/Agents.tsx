import { useEffect, useState } from "react";
import type { AgentSummary } from "../../shared/ipc";
import { chorale, agentColor } from "../bridge";

/** The toggles worth showing as chips, in display order. */
const TOGGLE_KEYS: { key: keyof AgentSummary["toggles"]; label: string }[] = [
  { key: "verify", label: "verify" },
  { key: "selfHeal", label: "selfHeal" },
  { key: "reviewGate", label: "reviewGate" },
  { key: "selfLearn", label: "selfLearn" },
  { key: "fewShot", label: "fewShot" },
  { key: "selfCritique", label: "selfCritique" },
  { key: "groundCheck", label: "groundCheck" },
];

export function Agents() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);

  useEffect(() => {
    chorale.listAgents().then(setAgents);
  }, []);

  if (!agents) return <div className="loading">loading agents…</div>;

  return (
    <div className="pad">
      <div className="pagehead">
        <h1>Agents</h1>
        <p>
          {agents.length} specialists, each a single <span className="mono">agent.md</span> — its own model, tools, and toggles. Author one by dropping in a file.
        </p>
      </div>
      <div className="grid">
        {agents.map((a) => {
          const active = TOGGLE_KEYS.filter((t) => a.toggles[t.key]);
          return (
            <div className="card" key={a.name} style={{ ["--acc" as string]: agentColor(a.name) }}>
              <div className="ch">
                <span className="sw" />
                <b>{a.name}</b>
                {a.tier && <span className="tier">{a.tier}</span>}
              </div>
              <div className="desc">{a.description}</div>
              <div className="kv">
                <span className="k">model</span>
                <span className="val">{a.model}</span>
              </div>
              {a.fallbacks.length > 0 && (
                <div className="kv">
                  <span className="k">fallback</span>
                  <span className="val">{a.fallbacks.join(" → ")}</span>
                </div>
              )}
              {a.tools.length > 0 && (
                <div className="tools">
                  {a.tools.map((t) => (
                    <span className="tool" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {active.length > 0 && (
                <div className="toggles">
                  {active.map((t) => (
                    <span className="tg on" key={t.key}>
                      {t.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

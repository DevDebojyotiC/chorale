import { useEffect, useState } from "react";
import type { ConfigSummary } from "../../shared/ipc";
import { chorale, agentColor, IS_MOCK } from "../bridge";
import { ModelsSettings } from "./settings/Models";

type Section = "models" | "routing" | "behavior" | "workspace";

const SECTIONS: { id: Section; label: string; blurb: string }[] = [
  { id: "models", label: "Models", blurb: "Providers, API keys, and the default model chain" },
  { id: "routing", label: "Routing", blurb: "Which model each agent resolves to" },
  { id: "behavior", label: "Behavior", blurb: "Runtime limits and permission tier" },
  { id: "workspace", label: "Workspace", blurb: "Where agents, config, and data live" },
];

const shortModel = (m: string): string => {
  const [prov, ...rest] = m.split(":");
  const id = rest.join(":");
  return `${prov}:${id.split("/").pop() ?? id}`;
};

export function Settings() {
  const [cfg, setCfg] = useState<ConfigSummary | null>(null);
  const [section, setSection] = useState<Section>("models");

  useEffect(() => {
    chorale.getConfig().then(setCfg);
  }, []);

  if (!cfg) return <div className="loading">loading settings…</div>;

  return (
    <div className="settings">
      <aside className="setrail">
        <div className="setrail-h">Settings</div>
        {SECTIONS.map((s) => (
          <button key={s.id} className="setrail-item" data-on={section === s.id ? "1" : "0"} onClick={() => setSection(s.id)} title={s.blurb}>
            {s.label}
          </button>
        ))}
      </aside>

      <div className="setmain">
        <div className="pagehead">
          <h1>{SECTIONS.find((s) => s.id === section)!.label}</h1>
          <p>
            {SECTIONS.find((s) => s.id === section)!.blurb}
            {IS_MOCK && <span style={{ color: "var(--warn)" }}> · preview (mock data)</span>}
          </p>
        </div>

        {section === "models" && <ModelsSettings cfg={cfg} onConfig={setCfg} />}

        {section === "routing" && (
          <div className="setsec">
            <h3>Agent → model</h3>
            <p className="setnote">
              Resolved per agent: its own <span className="mono">model</span> if it sets one, otherwise the default chain. Edit an agent in <b>Agents</b>.
            </p>
            <table className="route">
              <tbody>
                {cfg.routing.map((r) => (
                  <tr key={r.agent}>
                    <td>
                      <span className="ag">
                        <span className="sw" style={{ background: agentColor(r.agent) }} />
                        {r.agent}
                      </span>
                    </td>
                    <td className="m">{shortModel(r.model)}</td>
                    <td className="fb">{r.fallbacks.length ? "→ " + shortModel(r.fallbacks[0]!) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {section === "behavior" && (
          <div className="setsec">
            <h3>Runtime defaults</h3>
            <p className="setnote">Read-only in this build; editing lands with the Behavior section.</p>
            {Object.entries(cfg.defaults).map(([k, v]) => (
              <div className="row" key={k}>
                <span className="name">{k}</span>
                <span className="url">{String(v)}</span>
              </div>
            ))}
          </div>
        )}

        {section === "workspace" && (
          <div className="setsec">
            <h3>Locations</h3>
            <div className="row">
              <span className="name">agents dir</span>
              <span className="url mono">{cfg.agentsDir}</span>
            </div>
            <div className="row">
              <span className="name">profile</span>
              <span className="url">{cfg.activeProfile ?? "per-agent routing (no profile)"}</span>
            </div>
            <p className="setnote">
              Config and keys live in the workspace: <span className="mono">config/chorale.config.json5</span> and <span className="mono">.env</span> — the same files the CLI reads.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

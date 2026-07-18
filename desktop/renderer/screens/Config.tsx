import { useEffect, useState } from "react";
import type { ConfigSummary } from "../../shared/ipc";
import { chorale, agentColor } from "../bridge";

const shortUrl = (u: string | null): string => (u ? u.replace(/^https?:\/\//, "").replace(/\/+$/, "") : "");
const shortModel = (m: string): string => m.split(":").slice(1).join(":") || m;

export function Config() {
  const [cfg, setCfg] = useState<ConfigSummary | null>(null);

  useEffect(() => {
    chorale.getConfig().then(setCfg);
  }, []);

  if (!cfg) return <div className="loading">loading config…</div>;

  return (
    <div className="pad">
      <div className="pagehead">
        <h1>Config</h1>
        <p>
          Providers, model routing, and defaults — every provider is a few lines; keys live in <span className="mono">.env</span>, never in the file.
        </p>
      </div>
      <div className="cols">
        <div className="block">
          <h3>
            Providers <span className="c">{cfg.providers.length} configured</span>
          </h3>
          {cfg.providers.map((p) => (
            <div className="row" key={p.name}>
              <span className="dot" style={{ background: p.hasKey ? "var(--ok)" : p.api === "openai-compatible" && p.baseUrl?.includes("127.0.0.1") ? "var(--warn)" : "var(--faint)" }} />
              <span className="name">{p.name}</span>
              <span className="badge">{p.hasKey ? p.api : "no key"}</span>
              <span className="url">{shortUrl(p.baseUrl) || p.api}</span>
            </div>
          ))}
        </div>

        <div className="block">
          <h3>
            Model routing <span className="c">agent → model</span>
          </h3>
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

        <div className="block">
          <h3>Defaults</h3>
          {Object.entries(cfg.defaults).map(([k, v]) => (
            <div className="row" key={k}>
              <span className="name">{k}</span>
              <span className="url">{String(v)}</span>
            </div>
          ))}
        </div>

        <div className="block">
          <h3>
            Workspace <span className="c">{cfg.activeProfile ? "profile: " + cfg.activeProfile : "per-agent routing"}</span>
          </h3>
          <div className="row">
            <span className="name">agents dir</span>
            <span className="url">{cfg.agentsDir.replace(/\\/g, "/").split("/").slice(-2).join("/")}</span>
          </div>
        </div>
      </div>
      <p className="note">// edits will write back to config/chorale.config.json5 &amp; agents/*.md — the same files the CLI reads (read-only in this build).</p>
    </div>
  );
}

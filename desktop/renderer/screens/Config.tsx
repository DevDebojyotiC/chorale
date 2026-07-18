import { useEffect, useState } from "react";
import type { ConfigSummary, ProviderSummary } from "../../shared/ipc";
import { chorale, agentColor, IS_MOCK } from "../bridge";

const shortUrl = (u: string | null): string => (u ? u.replace(/^https?:\/\//, "").replace(/\/+$/, "") : "");
const shortModel = (m: string): string => m.split(":").slice(1).join(":") || m;

/** A provider row — editable key field for env-keyed providers, static for local ones. */
function ProviderRow({ p, onSave }: { p: ProviderSummary; onSave: (envVar: string, value: string) => Promise<void> }) {
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!p.envVar) {
    return (
      <div className="row">
        <span className="dot" style={{ background: p.hasKey ? "var(--ok)" : "var(--faint)" }} />
        <span className="name">{p.name}</span>
        <span className="badge">local</span>
        <span className="url">{shortUrl(p.baseUrl) || p.api}</span>
      </div>
    );
  }

  const save = async () => {
    if (!val.trim()) return;
    setSaving(true);
    await onSave(p.envVar!, val.trim());
    setSaving(false);
    setVal("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  return (
    <div className="row keyrow">
      <span className="dot" style={{ background: p.hasKey ? "var(--ok)" : "var(--warn)" }} title={p.hasKey ? "key set" : "no key"} />
      <span className="name">{p.name}</span>
      <input
        className="keyinput"
        type="password"
        spellCheck={false}
        placeholder={p.hasKey ? `${p.keyMasked} · replace…` : `paste ${p.envVar}…`}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
        }}
      />
      <button className="keysave" disabled={!val.trim() || saving} onClick={save}>
        {saved ? "✓ saved" : saving ? "…" : "save"}
      </button>
    </div>
  );
}

export function Config() {
  const [cfg, setCfg] = useState<ConfigSummary | null>(null);

  useEffect(() => {
    chorale.getConfig().then(setCfg);
  }, []);

  const saveKey = async (envVar: string, value: string) => {
    const next = await chorale.setKey(envVar, value);
    setCfg(next);
  };

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
            Providers <span className="c">keys saved to .env{IS_MOCK ? " (preview)" : ""}</span>
          </h3>
          {cfg.providers.map((p) => (
            <ProviderRow key={p.name} p={p} onSave={saveKey} />
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

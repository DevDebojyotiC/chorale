import { useState } from "react";
import type { ConfigSummary, EnvVarSummary } from "../../../shared/ipc";
import { chorale } from "../../bridge";

const BLURB: Record<string, { label: string; help: string; secret: boolean }> = {
  TAVILY_API_KEY: {
    label: "Tavily search",
    help: "Gives the research agent a real search API that returns page content. Without it, research falls back to scraping DuckDuckGo, which is unreliable and often rate-limited.",
    secret: true,
  },
  CHORALE_CHROME: {
    label: "Browser path override",
    help: "Only needed if Chrome/Edge isn't found automatically. Used to render JS pages for research and to verify that a built page actually opens.",
    secret: false,
  },
};

function EnvRow({ v, onSaved }: { v: EnvVarSummary; onSaved: (c: ConfigSummary) => void }) {
  const meta = BLURB[v.name] ?? { label: v.name, help: "", secret: true };
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(next: string) {
    setBusy(true);
    try {
      onSaved(await chorale.setKey(v.name, next));
      setEditing(false);
      setValue("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setrow wrap">
      <div className="setrow-l">
        <span className="setrow-k">{meta.label}</span>
        <span className="setrow-help">{meta.help}</span>
        <span className="setrow-env mono">{v.name}</span>
      </div>
      {editing ? (
        <>
          <input
            className="provkey"
            type={meta.secret ? "password" : "text"}
            autoFocus
            value={value}
            placeholder={meta.secret ? `paste ${v.name}` : "absolute path to chrome.exe"}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) void save(value);
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <button className="btn sm primary" disabled={busy || !value.trim()} onClick={() => save(value)}>
            Save
          </button>
          <button className="btn sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="setrow-val mono">{v.set ? v.masked || "set" : <span className="warnish">not set</span>}</span>
          <button className="btn sm" onClick={() => setEditing(true)}>
            {v.set ? "Change" : "Set"}
          </button>
          {v.set && (
            <button className="btn sm danger" onClick={() => void save("")}>
              Clear
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function ToolsSettings({ cfg, onConfig }: { cfg: ConfigSummary; onConfig: (c: ConfigSummary) => void }) {
  return (
    <>
      <div className="setsec">
        <h3>Integrations</h3>
        <p className="setnote">
          Stored in the workspace <span className="mono">.env</span>, same as provider keys.
        </p>
        {cfg.envVars.map((v) => (
          <EnvRow key={v.name} v={v} onSaved={onConfig} />
        ))}
      </div>

      <div className="setsec">
        <h3>Headless browser</h3>
        <p className="setnote">Used to read JavaScript-rendered pages for research, and to check that a page the coder built actually renders when opened.</p>
        <div className="setrow">
          <div className="setrow-l">
            <span className="setrow-k">Detected</span>
          </div>
          <span className="setrow-val mono">
            {cfg.headlessBrowser ? cfg.headlessBrowser : <span className="warnish">none found — install Chrome/Edge or set CHORALE_CHROME above</span>}
          </span>
        </div>
      </div>

      <div className="setsec">
        <h3>MCP servers</h3>
        <p className="setnote">
          Declared under <span className="mono">mcp.servers</span> in the config. Their tools are offered to agents that list them.
        </p>
        {cfg.mcpServers.length === 0 ? (
          <div className="body user mono">None configured.</div>
        ) : (
          cfg.mcpServers.map((s) => (
            <div className="setrow" key={s}>
              <div className="setrow-l">
                <span className="setrow-k mono">{s}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="setsec">
        <h3>Skill directories</h3>
        <p className="setnote">Scanned for Claude-compatible skills; only names and descriptions enter the prompt until a skill is opened.</p>
        {cfg.skillDirs.map((d) => (
          <div className="setrow" key={d}>
            <div className="setrow-l">
              <span className="setrow-k mono">{d}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

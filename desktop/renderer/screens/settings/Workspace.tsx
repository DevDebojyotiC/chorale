import type { ConfigSummary } from "../../../shared/ipc";
import { chorale, IS_MOCK } from "../../bridge";

function PathRow({ label, path, help }: { label: string; path: string; help?: string }) {
  return (
    <div className="setrow wrap">
      <div className="setrow-l">
        <span className="setrow-k">{label}</span>
        {help && <span className="setrow-help">{help}</span>}
        <span className="setrow-env mono">{path}</span>
      </div>
      <button className="btn sm" onClick={() => void chorale.openPath(path)} title="Open in your file manager">
        Open
      </button>
    </div>
  );
}

export function WorkspaceSettings({ cfg }: { cfg: ConfigSummary }) {
  const ws = cfg.workspace.replace(/[\\/]+$/, "");
  const join = (p: string) => `${ws}/${p}`;
  return (
    <>
      <div className="setsec">
        <h3>Locations</h3>
        <p className="setnote">
          Everything Chorale reads lives here — the same files the CLI uses. The packaged app keeps its own workspace, separate from a source checkout.
        </p>
        <PathRow label="Workspace" path={ws} help="Root for config, keys, agents, and data." />
        <PathRow label="Agents" path={cfg.agentsDir} help="One agent.md per specialist." />
        <PathRow label="Config" path={join("config")} help="chorale.config.json5 — providers, models, defaults." />
        <PathRow label="Data" path={join("data")} help="Sessions, learned lessons, and logs." />
      </div>

      <div className="setsec">
        <h3>Routing profile</h3>
        <p className="setnote">
          A profile can map whole tiers of agents onto different models at once. With none active, each agent uses its own model plus the default chain.
        </p>
        <div className="setrow">
          <div className="setrow-l">
            <span className="setrow-k">Active profile</span>
          </div>
          <span className="setrow-val mono">{cfg.activeProfile ?? "none (per-agent routing)"}</span>
        </div>
      </div>

      <div className="setsec">
        <h3>About</h3>
        <div className="setrow">
          <div className="setrow-l">
            <span className="setrow-k">Version</span>
          </div>
          <span className="setrow-val mono">
            {cfg.version}
            {IS_MOCK && " · preview"}
          </span>
        </div>
        <div className="setrow">
          <div className="setrow-l">
            <span className="setrow-k">Diagnostics</span>
            <span className="setrow-help">Provider reachability lives in Doctor; runs write a log here.</span>
          </div>
          <button className="btn sm" onClick={() => void chorale.openPath(join("data/logs"))}>
            Open logs
          </button>
        </div>
      </div>
    </>
  );
}

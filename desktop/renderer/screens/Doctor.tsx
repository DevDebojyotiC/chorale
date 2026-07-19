import { useEffect, useState } from "react";
import type { ProviderHealthItem } from "../../shared/ipc";
import { chorale } from "../bridge";

export function Doctor() {
  const [rows, setRows] = useState<ProviderHealthItem[] | null>(null);
  const [checking, setChecking] = useState(false);

  const run = () => {
    setChecking(true);
    chorale.checkDoctor().then((r) => {
      setRows(r);
      setChecking(false);
    });
  };
  useEffect(run, []);

  const reachable = rows ? rows.filter((r) => r.ok).length : 0;

  return (
    <div className="pad">
      <div className="pagehead" style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1>Doctor</h1>
          <p>Provider reachability. Pings each configured provider's endpoint with its key.</p>
        </div>
        <button className="btn" onClick={run} disabled={checking}>
          {checking ? "checking…" : "re-check"}
        </button>
      </div>
      <div className="cols" style={{ gridTemplateColumns: "1fr", maxWidth: 720 }}>
        <div className="block">
          <h3>
            Providers <span className="c">{rows ? `${reachable}/${rows.length} reachable` : "checking…"}</span>
          </h3>
          {!rows && (
            <div className="row">
              <span className="url mono" style={{ margin: 0 }}>
                pinging providers…
              </span>
            </div>
          )}
          {rows?.map((r) => (
            <div className="row" key={r.name}>
              <span className="dot" style={{ background: r.ok ? "var(--ok)" : "var(--crit)" }} />
              <span className="name">{r.name}</span>
              <span className="badge">{r.ok ? "reachable" : "down"}</span>
              <span className="url">
                {r.detail} · {r.ms}ms
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import type { PlaybookItem } from "../../shared/ipc";
import { chorale } from "../bridge";

const SOURCE_COLOR: Record<PlaybookItem["source"], string> = {
  seeded: "var(--a-general)",
  learned: "var(--a-scribe)",
  researched: "var(--a-research)",
};

export function Playbook() {
  const [items, setItems] = useState<PlaybookItem[] | null>(null);
  useEffect(() => {
    chorale.getPlaybook().then(setItems);
  }, []);
  if (!items) return <div className="loading">loading playbook…</div>;

  return (
    <div className="pad">
      <div className="pagehead">
        <h1>Playbook</h1>
        <p>Verified fixes the chorale has learned, recalled before it escalates to a stronger model. {items.length} entries.</p>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "1fr", maxWidth: 820 }}>
        {items.length === 0 && <div className="body user mono">Empty for now. Fixes get recorded as the repair ladder verifies them.</div>}
        {items.map((e) => (
          <div className="card" key={e.id} style={{ ["--acc" as string]: SOURCE_COLOR[e.source] }}>
            <div className="ch">
              <span className="sw" />
              <b>{e.title}</b>
              <span className="tier">{e.source}</span>
            </div>
            <div className="kv">
              <span className="k">context</span>
              <span className="val">{e.context}</span>
            </div>
            <div className="kv">
              <span className="k">symptom</span>
              <span className="val">{e.symptom}</span>
            </div>
            <div className="kv">
              <span className="k">fix</span>
              <span className="val">{e.solution}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

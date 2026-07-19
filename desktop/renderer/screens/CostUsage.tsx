import { useEffect, useState } from "react";
import type { UsageSummary } from "../../shared/ipc";
import { chorale } from "../bridge";

const k = (n: number): string => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
const money = (n: number | null): string => (n == null ? "—" : n > 0 ? "$" + n.toFixed(n < 0.01 ? 4 : 2) : "free");

export function CostUsage() {
  const [u, setU] = useState<UsageSummary | null>(null);
  useEffect(() => {
    chorale.getUsage().then(setU);
  }, []);
  if (!u) return <div className="loading">loading usage…</div>;

  return (
    <div className="pad">
      <div className="pagehead">
        <h1>Cost &amp; usage</h1>
        <p>Token spend by model across your sessions, estimated from public pricing. Local and free models cost nothing.</p>
      </div>
      <div className="cols" style={{ gridTemplateColumns: "1fr", maxWidth: 820 }}>
        <div className="block">
          <h3>
            By model <span className="c">{u.rows.length} model{u.rows.length === 1 ? "" : "s"}</span>
          </h3>
          <table className="route usage">
            <thead>
              <tr>
                <td>model</td>
                <td>reqs</td>
                <td>tokens in</td>
                <td>out</td>
                <td>est. cost</td>
              </tr>
            </thead>
            <tbody>
              {u.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="fb">
                    No usage yet. Start chatting and it builds up here.
                  </td>
                </tr>
              )}
              {u.rows.map((r) => (
                <tr key={r.model}>
                  <td className="m">{r.model.split(":").slice(1).join(":") || r.model}</td>
                  <td>{r.requests}</td>
                  <td>{k(r.inputTokens)}</td>
                  <td>{k(r.outputTokens)}</td>
                  <td>{money(r.cost)}</td>
                </tr>
              ))}
            </tbody>
            {u.rows.length > 0 && (
              <tfoot>
                <tr>
                  <td className="m">total</td>
                  <td />
                  <td>{k(u.totalIn)}</td>
                  <td>{k(u.totalOut)}</td>
                  <td>{money(u.totalCost)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

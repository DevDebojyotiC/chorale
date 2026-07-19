import { useEffect, useState } from "react";
import type { RemoteHost, RemoteHostInput, RemoteTestResult } from "../../shared/ipc";
import { chorale } from "../bridge";

const BLANK: RemoteHostInput = { label: "", host: "", port: 22, username: "", auth: "agent", privateKeyPath: "" };

export function Remote() {
  const [hosts, setHosts] = useState<RemoteHost[] | null>(null);
  const [form, setForm] = useState<RemoteHostInput | null>(null);
  const [tests, setTests] = useState<Record<string, RemoteTestResult | "testing">>({});

  useEffect(() => {
    chorale.remoteHosts().then(setHosts);
  }, []);

  function edit(h: RemoteHost) {
    setForm({ id: h.id, label: h.label, host: h.host, port: h.port, username: h.username, auth: h.auth, privateKeyPath: h.privateKeyPath ?? "" });
  }
  async function save() {
    if (!form || !form.host.trim() || !form.username.trim()) return;
    setHosts(await chorale.saveRemoteHost(form));
    setForm(null);
  }
  async function remove(id: string) {
    setHosts(await chorale.deleteRemoteHost(id));
  }
  async function test(id: string) {
    setTests((t) => ({ ...t, [id]: "testing" }));
    const r = await chorale.testRemoteHost(id);
    setTests((t) => ({ ...t, [id]: r }));
  }

  if (!hosts) return <div className="loading">loading hosts…</div>;

  return (
    <div className="pad">
      <div className="pagehead">
        <h1>Remote hosts</h1>
        <p>
          SSH connections a session can run on. A session folder can point at a remote path (<span className="mono">ssh://host/path</span>), and the explorer, diffs, and the agent's tools all work there. Secrets are never stored: auth is your OpenSSH agent or a private-key file on disk.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr", maxWidth: 720 }}>
        {hosts.length === 0 && !form && <div className="body user mono">No hosts yet. Add one to connect a session to a remote machine.</div>}

        {hosts.map((h) => {
          const t = tests[h.id];
          return (
            <div key={h.id} className="card remotecard">
              <div className="ch">
                <span className={"dot" + (t && t !== "testing" ? (t.ok ? " ok" : " bad") : "")} />
                <b>{h.label}</b>
                <span className="mono remoteaddr">
                  {h.username}@{h.host}:{h.port}
                </span>
                <span className="tier">{h.auth === "agent" ? "ssh-agent" : "key"}</span>
              </div>
              <div className="kv">
                {t === "testing" ? (
                  <span className="val mono">testing…</span>
                ) : t ? (
                  <span className="val mono" style={{ color: t.ok ? "var(--ok)" : "var(--crit)" }}>
                    {t.ok ? `✓ ${t.detail} · ${t.ms}ms` : `✕ ${t.detail}`}
                  </span>
                ) : (
                  <span className="val mono" style={{ color: "var(--faint)" }}>
                    {h.privateKeyPath ?? "via agent"}
                  </span>
                )}
                <div className="remoteactions">
                  <button className="btn sm" onClick={() => test(h.id)}>
                    Test
                  </button>
                  <button className="btn sm" onClick={() => edit(h)}>
                    Edit
                  </button>
                  <button className="btn sm danger" onClick={() => remove(h.id)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {form ? (
          <div className="card remoteform">
            <div className="ch">
              <b>{form.id ? "Edit host" : "New host"}</b>
            </div>
            <div className="formgrid">
              <label>
                Label
                <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="prod-box" />
              </label>
              <label>
                Host
                <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="203.0.113.10 or host.example.com" />
              </label>
              <label className="narrow">
                Port
                <input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) || 22 })} />
              </label>
              <label>
                Username
                <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="deploy" />
              </label>
              <label>
                Auth
                <select value={form.auth} onChange={(e) => setForm({ ...form, auth: e.target.value as "agent" | "key" })}>
                  <option value="agent">OpenSSH agent</option>
                  <option value="key">Private key file</option>
                </select>
              </label>
              {form.auth === "key" && (
                <label className="wide">
                  Private key path
                  <input value={form.privateKeyPath} onChange={(e) => setForm({ ...form, privateKeyPath: e.target.value })} placeholder="~/.ssh/id_ed25519" />
                </label>
              )}
            </div>
            <div className="editor-actions">
              <button className="btn primary" onClick={save} disabled={!form.host.trim() || !form.username.trim()}>
                Save host
              </button>
              <button className="btn" onClick={() => setForm(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="btn addhost" onClick={() => setForm({ ...BLANK })}>
            ＋ Add host
          </button>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import type { ConfigSummary, ProviderModels, ProviderSummary } from "../../../shared/ipc";
import { chorale } from "../../bridge";

/** A provider is usable as a chain entry when it needs no key (local) or has one set. */
const usable = (p: ProviderSummary): boolean => p.hasKey || p.envVar === null;
const providerOf = (ref: string): string => ref.split(":")[0] ?? "";
const modelOf = (ref: string): string => ref.slice(ref.indexOf(":") + 1);

function KeyRow({ p, onSaved }: { p: ProviderSummary; onSaved: (c: ConfigSummary) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const local = p.envVar === null;

  async function save() {
    if (!p.envVar) return;
    setBusy(true);
    try {
      onSaved(await chorale.setKey(p.envVar, value));
      setEditing(false);
      setValue("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="provrow">
      <span className={"provdot" + (usable(p) ? " on" : "")} />
      <span className="provname">{p.name}</span>
      <span className="provapi">{local ? "local" : p.api}</span>

      {editing ? (
        <>
          <input
            className="provkey"
            type="password"
            autoFocus
            value={value}
            placeholder={`paste ${p.envVar}`}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <button className="btn sm primary" onClick={save} disabled={busy || !value.trim()}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button className="btn sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="provstate">
            {local ? <span className="ok">no key needed</span> : p.hasKey ? <span className="ok mono">{p.keyMasked}</span> : <span className="warnish">no key set</span>}
          </span>
          {!local && (
            <button className="btn sm" onClick={() => setEditing(true)}>
              {p.hasKey ? "Change" : "Add key"}
            </button>
          )}
          {!local && p.hasKey && (
            <button className="btn sm danger" onClick={() => void chorale.setKey(p.envVar!, "").then(onSaved)} title={`Clear ${p.envVar}`}>
              Clear
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** One entry of the default model chain: provider → model. */
function ChainRow({
  index,
  ref_,
  providers,
  modelsFor,
  onChange,
  onRemove,
}: {
  index: number;
  ref_: string;
  providers: ProviderSummary[];
  modelsFor: (p: string) => ProviderModels | undefined;
  onChange: (next: string) => void;
  onRemove: () => void;
}) {
  const prov = providerOf(ref_);
  const model = modelOf(ref_);
  const list = modelsFor(prov);
  const options = list?.models ?? [];
  // Keep the configured model selectable even if the provider didn't list it.
  const withCurrent = model && !options.includes(model) ? [model, ...options] : options;

  return (
    <div className="chainrow">
      <span className="chainno">{index + 1}</span>
      <span className="chainrole">{index === 0 ? "primary" : "fallback"}</span>

      <select className="modesel grow" value={prov} onChange={(e) => onChange(`${e.target.value}:`)}>
        {providers.map((p) => (
          <option key={p.name} value={p.name} disabled={!usable(p)}>
            {p.name}
            {usable(p) ? "" : " — no key"}
          </option>
        ))}
      </select>

      <select className="modesel grow2" value={model} onChange={(e) => onChange(`${prov}:${e.target.value}`)} disabled={!prov}>
        <option value="">{list ? (options.length ? "choose a model…" : "no models returned") : "loading…"}</option>
        {withCurrent.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      {list?.source === "catalog" && <span className="chainhint" title={list.error ?? "the provider didn't answer; showing a curated list"}>curated</span>}

      <button className="btn sm danger" onClick={onRemove} title="Remove from the chain">
        ✕
      </button>
    </div>
  );
}

export function ModelsSettings({ cfg, onConfig }: { cfg: ConfigSummary; onConfig: (c: ConfigSummary) => void }) {
  const [chain, setChain] = useState<string[]>(cfg.chain);
  const [models, setModels] = useState<Record<string, ProviderModels>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setChain(cfg.chain), [cfg.chain]);

  // Fetch the model list for every usable provider (live where the provider supports it).
  useEffect(() => {
    for (const p of cfg.providers) {
      if (!usable(p) || models[p.name]) continue;
      void chorale.listModels(p.name).then((r) => setModels((m) => ({ ...m, [p.name]: r })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.providers]);

  const firstUsable = cfg.providers.find(usable)?.name ?? "";
  const dirty = JSON.stringify(chain) !== JSON.stringify(cfg.chain);
  const complete = chain.length > 0 && chain.every((r) => providerOf(r) && modelOf(r));

  async function save() {
    setSaving(true);
    try {
      onConfig(await chorale.setModelChain(chain));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="setsec">
        <h3>Providers</h3>
        <p className="setnote">
          Keys are written to the workspace <span className="mono">.env</span>, never into the config file. Local runtimes (Ollama, LM Studio) need no key.
        </p>
        <div className="provlist">
          {cfg.providers.map((p) => (
            <KeyRow key={p.name} p={p} onSaved={onConfig} />
          ))}
        </div>
      </div>

      <div className="setsec">
        <h3>Default model chain</h3>
        <p className="setnote">
          The models every agent inherits, tried in order: #1 is the primary, the rest are fallbacks used when one fails. Providers without a key can&apos;t be selected. Individual agents can override this in <b>Agents</b>.
        </p>

        <div className="chainlist">
          {chain.map((r, i) => (
            <ChainRow
              key={i}
              index={i}
              ref_={r}
              providers={cfg.providers}
              modelsFor={(p) => models[p]}
              onChange={(next) => setChain((c) => c.map((v, j) => (j === i ? next : v)))}
              onRemove={() => setChain((c) => c.filter((_, j) => j !== i))}
            />
          ))}
          {chain.length === 0 && <div className="body user mono">No models configured. Add one below.</div>}
        </div>

        <div className="chainactions">
          <button className="btn sm" onClick={() => setChain((c) => [...c, `${firstUsable}:`])} disabled={!firstUsable}>
            ＋ Add {chain.length === 0 ? "model" : "fallback"}
          </button>
          <div className="spacer" />
          {!complete && chain.length > 0 && <span className="setwarn">every row needs a provider and a model</span>}
          {saved && <span className="setok">saved</span>}
          <button className="btn primary" onClick={save} disabled={!dirty || !complete || saving}>
            {saving ? "Saving…" : "Save chain"}
          </button>
        </div>
      </div>
    </>
  );
}

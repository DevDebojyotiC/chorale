import { useState } from "react";
import type { ConfigSummary, PermissionMode } from "../../../shared/ipc";
import { chorale } from "../../bridge";

/** Bounds mirror the zod schema in src/core/config.ts, so the UI can't write an invalid value. */
const LIMITS: Record<string, { min: number; max: number; step: number; label: string; help: string }> = {
  maxSteps: { min: 1, max: 64, step: 1, label: "Max steps", help: "Tool steps an agent may take per attempt." },
  maxDelegationDepth: { min: 1, max: 5, step: 1, label: "Delegation depth", help: "How deep the orchestrator may nest specialists." },
  maxVerifyRounds: { min: 1, max: 8, step: 1, label: "Verify rounds", help: "Repair attempts after a failed verify/smoke check." },
  maxRetries: { min: 0, max: 5, step: 1, label: "Retries", help: "Retries of the SAME model on a transient error before falling back." },
  requestTimeoutMs: { min: 10_000, max: 900_000, step: 5_000, label: "Request timeout (ms)", help: "A hung provider aborts and falls back instead of hanging." },
  maxOutputTokens: { min: 512, max: 200_000, step: 512, label: "Max output tokens", help: "Left too low, long files and plans silently truncate mid-token." },
};

function NumberRow({ k, value, onSave }: { k: string; value: number; onSave: (v: number) => Promise<void> }) {
  const lim = LIMITS[k];
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const n = Number(draft);
  const valid = Number.isFinite(n) && (!lim || (n >= lim.min && n <= lim.max));
  const dirty = n !== value;

  return (
    <div className="setrow">
      <div className="setrow-l">
        <span className="setrow-k">{lim?.label ?? k}</span>
        {lim && <span className="setrow-help">{lim.help}</span>}
      </div>
      <input
        className="setnum"
        type="number"
        value={draft}
        min={lim?.min}
        max={lim?.max}
        step={lim?.step}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valid && dirty) void save();
        }}
      />
      <button className="btn sm primary" disabled={!valid || !dirty || busy} onClick={save}>
        {busy ? "…" : "Save"}
      </button>
      {!valid && lim && <span className="setwarn">{lim.min}–{lim.max}</span>}
    </div>
  );

  async function save() {
    setBusy(true);
    try {
      await onSave(n);
    } finally {
      setBusy(false);
    }
  }
}

const MODES: { id: PermissionMode; label: string; blurb: string }[] = [
  { id: "read-only", label: "Read-only", blurb: "Inspect only. No file writes, no shell." },
  { id: "auto-edit", label: "Auto-edit", blurb: "Edits apply automatically; shell commands ask first." },
  { id: "full-auto", label: "Full-auto", blurb: "Edits and shell run without asking." },
];

export function PermissionsSettings({ cfg, onConfig }: { cfg: ConfigSummary; onConfig: (c: ConfigSummary) => void }) {
  const [busy, setBusy] = useState(false);
  const set = async (mode: PermissionMode) => {
    setBusy(true);
    try {
      onConfig(await chorale.setConfigValue("permissions", "mode", mode));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="setsec">
      <h3>Default approval tier</h3>
      <p className="setnote">What an agent may do without asking. A chat can still override this per turn from the composer.</p>
      <div className="modelist">
        {MODES.map((m) => (
          <button key={m.id} className="modeopt" data-on={cfg.permissionMode === m.id ? "1" : "0"} disabled={busy} onClick={() => set(m.id)}>
            <span className="modeopt-h">{m.label}</span>
            <span className="modeopt-b">{m.blurb}</span>
          </button>
        ))}
      </div>
      <p className="setnote" style={{ marginTop: 16 }}>
        Regardless of tier, a catastrophic-command denylist always applies to the shell (recursive deletes of <span className="mono">/</span> or <span className="mono">~</span>, fork bombs, <span className="mono">mkfs</span>, disk writes, shutdown). File tools are always sandboxed to the session folder.
      </p>
    </div>
  );
}

export function BehaviorSettings({ cfg, onConfig }: { cfg: ConfigSummary; onConfig: (c: ConfigSummary) => void }) {
  const save = async (key: string, v: number) => {
    onConfig(await chorale.setConfigValue("defaults", key, v));
  };
  return (
    <div className="setsec">
      <h3>Runtime limits</h3>
      <p className="setnote">
        Written to <span className="mono">defaults</span> in the config, which the CLI reads too. Values are bounded by the schema.
      </p>
      {Object.entries(cfg.defaults).map(([k, v]) => (
        <NumberRow key={k} k={k} value={v} onSave={(n) => save(k, n)} />
      ))}
    </div>
  );
}

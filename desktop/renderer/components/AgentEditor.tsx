import { useEffect, useState } from "react";
import type { AgentSummary } from "../../shared/ipc";
import { chorale } from "../bridge";

const TEMPLATE = `---
name: my-agent
description: One-line description of what this agent does.
model: \${base}
tier: other
tools: [read, ls, glob, grep]
---

You are **my-agent**. Describe the persona, the job, and how it should behave.
`;

/** Full-source editor for an agent.md — the "author an agent by dropping in a file" flow, in-UI. */
export function AgentEditor({ name, onClose, onSaved }: { name: string | null; onClose: () => void; onSaved: (agents: AgentSummary[]) => void }) {
  const isNew = name === null;
  const [nameField, setNameField] = useState(name ?? "");
  const [source, setSource] = useState<string | null>(isNew ? TEMPLATE : null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isNew && name) chorale.getAgentSource(name).then(setSource);
  }, [isNew, name]);

  const save = async () => {
    if (source === null) return;
    setSaving(true);
    setError(null);
    const res = await chorale.saveAgent(isNew ? nameField : name!, source);
    setSaving(false);
    if (res.ok) {
      onSaved(res.agents ?? []);
      onClose();
    } else {
      setError(res.error ?? "Could not save the agent.");
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal editor" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="editor-h">
          <b>{isNew ? "New agent" : `Edit ${name}`}</b>
          <span className="editor-sub mono">agents/{(isNew ? nameField || "…" : name)?.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.md</span>
          <div className="spacer" />
          <button className="tbtn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {isNew && (
          <input className="editor-name mono" placeholder="agent-name" value={nameField} onChange={(e) => setNameField(e.target.value)} spellCheck={false} />
        )}
        <textarea className="editor-src mono" value={source ?? "loading…"} onChange={(e) => setSource(e.target.value)} spellCheck={false} disabled={source === null} />
        {error && <div className="editor-err mono">⚠ {error}</div>}
        <div className="editor-actions">
          <span className="editor-hint mono">frontmatter (name · model · tools · toggles) + persona</span>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving || source === null || (isNew && !nameField.trim())}>
            {saving ? "saving…" : "Save agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

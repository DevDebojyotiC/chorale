import { useEffect, useMemo, useRef, useState } from "react";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  /** A short group label, e.g. "Go to" / "Agent". */
  group?: string;
  run: () => void;
}

/** Subsequence fuzzy score — higher is better, null if `q` isn't a subsequence of `label`. */
export function fuzzyScore(label: string, q: string): number | null {
  if (!q) return 0;
  const l = label.toLowerCase();
  const query = q.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < l.length && qi < query.length; i++) {
    if (l[i] === query[qi]) {
      qi++;
      streak++;
      score += streak + (i === 0 ? 4 : 0);
    } else {
      streak = 0;
    }
  }
  return qi === query.length ? score : null;
}

export function CommandPalette({ commands, placeholder = "Type a command…", onClose }: { commands: Command[]; placeholder?: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    return commands
      .map((c) => ({ c, s: fuzzyScore(c.label + " " + (c.hint ?? ""), q) }))
      .filter((x): x is { c: Command; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [commands, q]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-sel="1"]')?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <input
          ref={inputRef}
          className="palette-input"
          value={q}
          placeholder={placeholder}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(filtered[sel]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && <div className="empty">No matching commands.</div>}
          {filtered.map((c, i) => (
            <button key={c.id} className="palette-item" data-sel={i === sel ? "1" : "0"} onMouseMove={() => setSel(i)} onClick={() => run(c)}>
              {c.group && <span className="palette-group">{c.group}</span>}
              <span className="palette-label">{c.label}</span>
              {c.hint && <span className="palette-hint">{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

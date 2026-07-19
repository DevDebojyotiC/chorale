import { useState } from "react";
import type { ActivityEvent } from "../../shared/ipc";
import { agentColor, eventStyle } from "../bridge";

interface Leaf {
  type: string;
  text: string;
}
interface Node {
  key: string;
  agent: string;
  /** For a plan node: the "decomposed → N steps" label. */
  label?: string;
  steps?: { agent: string; title: string }[];
  events: Leaf[];
  children: Node[];
}

/**
 * Fold the flat, depth-attributed event stream into a delegation tree:
 * `delegate` opens a child node for the target (its events nest until `delegate-done`),
 * `plan` adds a planner node carrying the decomposition, everything else is a leaf.
 */
function buildTree(events: ActivityEvent[], entryAgent: string): Node {
  const root: Node = { key: "root", agent: entryAgent, events: [], children: [] };
  const stack: Node[] = [root];
  let seq = 0;
  for (const ev of events) {
    const top = stack[stack.length - 1]!;
    if (ev.type === "delegate" && ev.target) {
      const child: Node = { key: `d${seq++}`, agent: ev.target, events: ev.text ? [{ type: "task", text: ev.text }] : [], children: [] };
      top.children.push(child);
      stack.push(child);
    } else if (ev.type === "delegate-done") {
      if (stack.length > 1) stack.pop();
    } else if (ev.type === "plan") {
      top.children.push({ key: `p${seq++}`, agent: ev.agent ?? "planner", label: ev.text, steps: ev.steps, events: [], children: [] });
    } else {
      top.events.push({ type: ev.type, text: ev.text });
    }
  }
  return root;
}

function TreeNode({ node, highlight, root = false }: { node: Node; highlight: Set<string>; root?: boolean }) {
  const starred = highlight.has(node.agent);
  return (
    <div className={"tnode" + (root ? " root" : "")}>
      <div className="tnode-h">
        <span className="sw" style={{ background: agentColor(node.agent) }} />
        <b style={{ color: agentColor(node.agent) }}>{node.agent}</b>
        {starred && <span className="tstar" title="you asked for this agent">★</span>}
        {node.label && <span className="tnode-label">{node.label}</span>}
      </div>
      {node.steps && node.steps.length > 0 && (
        <div className="tsteps">
          {node.steps.map((s, i) => (
            <div className="tstep" key={i}>
              <span className="sw sm" style={{ background: agentColor(s.agent) }} />
              <span className="tstep-t">{s.title}</span>
            </div>
          ))}
        </div>
      )}
      {node.events.map((e, i) => {
        const st = eventStyle(e.type);
        return (
          <div className={"tleaf" + (e.type === "task" ? " task" : "")} key={i} style={{ ["--acc" as string]: st.color }}>
            <span className="dotc" />
            <span className="tleaf-t">{e.text}</span>
          </div>
        );
      })}
      {node.children.map((c) => (
        <TreeNode key={c.key} node={c} highlight={highlight} />
      ))}
    </div>
  );
}

/** Derive the plan checklist + per-agent status from the event stream. */
function derivePlan(events: ActivityEvent[]): { steps: { agent: string; title: string }[]; running: Set<string>; done: Set<string>; sawDelegate: boolean } {
  const planEv = events.find((e) => e.type === "plan");
  const running = new Set<string>();
  const done = new Set<string>();
  let sawDelegate = false;
  for (const e of events) {
    if (e.type === "delegate" && e.target) {
      running.add(e.target);
      sawDelegate = true;
    }
    if (e.type === "delegate-done" && e.target) {
      done.add(e.target);
      running.delete(e.target);
    }
  }
  return { steps: planEv?.steps ?? [], running, done, sawDelegate };
}

/**
 * The plan & progress card shown in the chat thread: a checklist that ticks off as specialists finish.
 * `collapsible` (completed turns) renders a one-line summary that expands on click.
 */
export function PlanCard({ events, named, collapsible = false }: { events: ActivityEvent[]; named: Set<string>; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible);
  const { steps, running, done, sawDelegate } = derivePlan(events);

  if (steps.length === 0) {
    // No decomposition yet (or a simple direct answer). Only show the "planning" hint while live.
    return collapsible || sawDelegate ? null : <div className="plancard planning"><span className="pc-spin" /> planning the task…</div>;
  }
  const status = (a: string): "done" | "running" | "pending" => (done.has(a) ? "done" : running.has(a) ? "running" : "pending");

  if (collapsible && !open) {
    const ran = [...new Set(steps.filter((s) => done.has(s.agent) || running.has(s.agent)).map((s) => s.agent))];
    return (
      <button className="plancard collapsed" onClick={() => setOpen(true)}>
        ▸ planned · {ran.join(" · ") || "orchestrated"} <span className="pc-n">({steps.length} steps)</span>
      </button>
    );
  }
  return (
    <div className="plancard">
      <div className="pc-h">
        <b>Plan</b>
        {collapsible && (
          <button className="pc-toggle" onClick={() => setOpen(false)}>
            collapse
          </button>
        )}
      </div>
      {steps.map((s, i) => {
        const st = status(s.agent);
        return (
          <div className={"pc-step " + st} key={i}>
            <span className="pc-mark">{st === "done" ? "✓" : st === "running" ? "◷" : "○"}</span>
            <span className="sw sm" style={{ background: agentColor(s.agent) }} />
            <span className="pc-agent">{s.agent}</span>
            {named.has(s.agent) && <span className="tstar" title="you asked for this agent">★</span>}
            <span className="pc-title">{s.title}</span>
          </div>
        );
      })}
    </div>
  );
}

export function DelegationTree({ events, entryAgent, highlight, busy }: { events: ActivityEvent[]; entryAgent: string; highlight: Set<string>; busy: boolean }) {
  const root = buildTree(events, entryAgent);
  if (root.events.length === 0 && root.children.length === 0) {
    return <div className="empty">{busy ? "the orchestra is starting…" : "The plan, decomposition, and each specialist's work will appear here as a tree."}</div>;
  }
  return (
    <div className="deltree">
      <TreeNode node={root} highlight={highlight} root />
    </div>
  );
}

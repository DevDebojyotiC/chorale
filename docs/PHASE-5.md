# Phase 5 — Desktop UI

> **Status:** in progress · **Branch:** `phase-5` · **Last updated:** 2026-07-18

A native desktop GUI over the **UI-agnostic core** — the Claude-Desktop-replacement front end. The core
already exposes exactly the seam a GUI needs, so the UI is a *delivery layer*, not a capability change.

## 1. Decisions (approved)
- **Electron desktop app from the start** (not web-first). Native window; the closest thing to "replace
  Claude Desktop." Renderer is **React 19 + Vite 8 + TypeScript**; main/preload built with **esbuild**.
  (electron-vite was skipped — it caps at Vite 7 while the repo runs Vite 8 via Vitest.)
- **Visual direction — a mono-forward "console"** grounded in Chorale's CLI origin: monospace for
  labels/agent-names/model-IDs/metrics, clean sans for message prose. **Per-agent color coding** (the
  "orchestra sections" metaphor) carried across the roster, chat, activity rail, and routing. Teal brand
  accent; semantic good/warn/critical kept separate. **Full light + dark**, token-driven, system-aware.

## 2. Architecture
- **`desktop/main.ts`** (Electron main) hosts the core — `loadConfig`, `buildRegistry`, `loadAgent`,
  `resolveModelPlan`, `runAgent` — and exposes it ONLY through typed IPC channels.
- **`desktop/preload.ts`** — `contextBridge` exposes `window.chorale` (`listAgents`, `getConfig`, `run`).
  Renderer runs with `contextIsolation` on, no Node, no open port.
- **`desktop/shared/ipc.ts`** — the typed contract shared by both sides. `runAgent`'s `onToken`/`onEvent`
  stream to the renderer over `run:msg`; the live activity rail renders those events.
- **`desktop/renderer/`** — the React app: `App` (shell/nav/theme), `screens/{Chat,Agents,Config}`,
  `theme.css` (design tokens), `bridge.ts` (typed `window.chorale` + per-agent color map).
- Native modules (`better-sqlite3`) are rebuilt for Electron's ABI via `@electron/rebuild`.

## 3. Shipped so far
- **Shell** — left nav (Chat / Agents / Config / Sessions + Observe stubs), top bar, theme toggle, keys.
- **Chat** — agent picker (per-agent color), streaming replies via IPC, the **live activity rail** that
  visualizes the pipeline (tool / verify / heal / fallback / lesson events), per-turn token readout;
  **multi-turn history** threaded into every run, **New chat** control.
- **Sessions** — browse saved conversations and **resume** one back into Chat.
- **Persistence** — user/assistant messages + usage saved to the SQLite `SessionStore`; **best-effort**,
  so if `better-sqlite3` didn't load the app still opens and chats (no persistence), mirroring how the
  core guards its lesson store.
- **Agents** — the roster from the real `agent.md` files (model, fallbacks, tools, tier, toggles).
- **Config** — providers (status from resolved keys), agent→model routing, defaults, workspace.

## 4. Run it
```
npm run ui:rebuild   # once — rebuilds better-sqlite3 for Electron's ABI (needs a C++ toolchain)
npm run ui           # build main+preload+renderer, then launch the window
npm run ui:dev       # dev mode: Vite HMR for the renderer + Electron
```

## 5. Next (planned)
`5d` Agents editor (edit the `agent.md` in-UI) · `5e` Config write-back (edit providers/routing → the same
files the CLI reads) · `5f` Observe (Cost & usage charts, Playbook & Lessons, Doctor) · session titles ·
`5g` packaging (`electron-builder`).

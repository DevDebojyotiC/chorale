# Phase 5 — Desktop UI

> **Status:** UI complete end-to-end (installer builds + runs) · **Branch:** `phase-5` · **Last updated:** 2026-07-19

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

## 3. Shipped — the 7 completion steps (all done)
1. **Verify & harden** — a mock bridge lets the renderer run in a plain browser for visual verification;
   every screen verified live; UI-level **turn cancellation** (Stop button).
2. **Workspace + first-run** — dev uses the repo cwd; packaged seeds a per-user workspace under userData
   from the bundled defaults (`desktop/workspace.ts`, unit-tested).
3. **Settings write-back** — editable, masked **provider keys** written to the workspace `.env` with a
   live registry reload (status flips immediately).
4. **Tool-permission approval** — a pluggable approver seam (`setApprover`) routes shell approvals to a
   GUI **modal** instead of a (nonexistent) TTY; a per-turn **mode selector** (read-only/auto-edit/full-auto).
5. **Agents editor** — click a card to edit its `agent.md` source; **New agent** from a template; saves
   validate by loading, so a broken file surfaces an error instead of a broken agent.
6. **Observe** — **Cost & usage** (per-model tokens + est. cost), **Playbook** (learned fixes), **Doctor**
   (provider reachability).
7. **Packaging** — `electron-builder` → **`Chorale-Setup-0.2.0.exe`** (NSIS installer). First-run seeding
   verified in the packaged app.

**Persistence caveat (honest):** `better-sqlite3` is a native addon built for Node's ABI, not Electron's,
and it needs a C++ compiler to rebuild (none on the build machine). So in both the dev and packaged app
the SQLite store fails to load — the app **degrades gracefully**: chat (incl. multi-turn within a session,
held in the renderer) works, but cross-session **persistence, the Sessions list, and store-backed Cost &
usage are inactive**. The run loop's self-learn path is guarded the same way. Proper fix (planned):
migrate the store to Node's built-in `node:sqlite` (no native module, ABI-agnostic — works in Node *and*
Electron with no rebuild), or build the installer on a machine with a compiler.

Plus the foundation: shell/nav/theme, Chat (streaming + live activity rail + tokens + multi-turn history),
Sessions (browse + resume), best-effort persistence.

## 4. Run it
```
npm run ui           # build + launch the window (dev)
npm run ui:dev       # dev mode: Vite HMR + Electron
npm run dist         # build the installer (release/Chorale-Setup-<version>.exe)
```
Note: on Windows, if `dist` hits an `EPERM` renaming `win-unpacked` (Defender locking the fresh Electron
extract), build to a temp dir: `npx electron-builder -c.directories.output=%TEMP%/chorale-rel`.

## 5. Polish backlog (non-blocking)
Custom app icon (ships with the default Electron icon today) · true backend run-cancellation (currently
UI-level) · defaults editing in Config · session titles · cross-platform installer testing (mac/linux
config present, built on Windows only).

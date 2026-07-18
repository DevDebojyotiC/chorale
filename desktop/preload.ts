/**
 * Preload — the ONLY bridge between the isolated renderer and the main process. Exposes a typed
 * `window.chorale` API over contextBridge; the renderer never sees ipcRenderer or Node directly.
 */
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type RunHandlers, type RunMsg, type ChoraleBridge } from "./shared/ipc.js";

let seq = 0;

const bridge: ChoraleBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  listAgents: () => ipcRenderer.invoke(IPC.agentsList),
  getConfig: () => ipcRenderer.invoke(IPC.configGet),
  newSession: (agent) => ipcRenderer.invoke(IPC.sessionNew, agent),
  listSessions: () => ipcRenderer.invoke(IPC.sessionList),
  loadSession: (id) => ipcRenderer.invoke(IPC.sessionLoad, id),
  run: (req, handlers: RunHandlers) => {
    const runId = `r${Date.now().toString(36)}_${seq++}`;
    const listener = (_e: unknown, msg: RunMsg): void => {
      if (msg.runId !== runId) return;
      if (msg.kind === "token") handlers.onToken?.(msg.text);
      else if (msg.kind === "event") handlers.onEvent?.(msg.eventType, msg.text);
      else if (msg.kind === "done") {
        handlers.onDone?.(msg.model, msg.text, msg.usage);
        cleanup();
      } else if (msg.kind === "error") {
        handlers.onError?.(msg.message);
        cleanup();
      }
    };
    const cleanup = (): void => ipcRenderer.removeListener(IPC.runMsg, listener);
    ipcRenderer.on(IPC.runMsg, listener);
    ipcRenderer.send(IPC.runStart, { runId, ...req });
    return () => {
      ipcRenderer.send(IPC.runCancel, runId);
      cleanup();
    };
  },
};

contextBridge.exposeInMainWorld("chorale", bridge);

/**
 * Preload — the ONLY bridge between the isolated renderer and the main process. Exposes a typed
 * `window.chorale` API over contextBridge; the renderer never sees ipcRenderer or Node directly.
 */
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type RunHandlers, type RunMsg, type ChoraleBridge, type PermissionReq } from "./shared/ipc.js";

let seq = 0;

const bridge: ChoraleBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  listAgents: () => ipcRenderer.invoke(IPC.agentsList),
  getAgentSource: (name) => ipcRenderer.invoke(IPC.agentSource, name),
  saveAgent: (name, source) => ipcRenderer.invoke(IPC.agentSave, name, source),
  getConfig: () => ipcRenderer.invoke(IPC.configGet),
  setKey: (envVar, value) => ipcRenderer.invoke(IPC.settingsSetKey, envVar, value),
  getUsage: () => ipcRenderer.invoke(IPC.observeUsage),
  getPlaybook: () => ipcRenderer.invoke(IPC.observePlaybook),
  checkDoctor: () => ipcRenderer.invoke(IPC.observeDoctor),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  readDir: (path) => ipcRenderer.invoke(IPC.fsReadDir, path),
  readFile: (path) => ipcRenderer.invoke(IPC.fsReadFile, path),
  listFiles: (folder) => ipcRenderer.invoke(IPC.fsListFiles, folder),
  pickFiles: () => ipcRenderer.invoke(IPC.pickFiles),
  gitStatus: (folder) => ipcRenderer.invoke(IPC.gitStatus, folder),
  gitDiff: (folder, file) => ipcRenderer.invoke(IPC.gitDiff, folder, file),
  remoteHosts: () => ipcRenderer.invoke(IPC.remoteList),
  saveRemoteHost: (input) => ipcRenderer.invoke(IPC.remoteSave, input),
  deleteRemoteHost: (id) => ipcRenderer.invoke(IPC.remoteDelete, id),
  testRemoteHost: (id) => ipcRenderer.invoke(IPC.remoteTest, id),
  newSession: (agent, folder) => ipcRenderer.invoke(IPC.sessionNew, agent, folder ?? null),
  setSessionFolder: (id, folder) => ipcRenderer.invoke(IPC.sessionSetFolder, id, folder),
  setSessionTitle: (id, title) => ipcRenderer.invoke(IPC.sessionSetTitle, id, title),
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
  onPermission: (cb: (req: PermissionReq) => void) => {
    const listener = (_e: unknown, req: PermissionReq): void => cb(req);
    ipcRenderer.on(IPC.permissionRequest, listener);
    return () => ipcRenderer.removeListener(IPC.permissionRequest, listener);
  },
  respondPermission: (id: string, approved: boolean) => ipcRenderer.send(IPC.permissionResponse, id, approved),
  setTitleBarOverlay: (color: string, symbolColor: string) => ipcRenderer.send(IPC.winSetOverlay, color, symbolColor),
};

contextBridge.exposeInMainWorld("chorale", bridge);

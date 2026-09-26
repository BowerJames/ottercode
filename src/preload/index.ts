import { contextBridge, ipcRenderer } from "electron";

// The door. One raw transport, mechanically exposed — no logic, no state.
// If an `if` shows up here, the contract is wrong; typing lives in
// shared/ipc/client.ts, which wraps this into the typed client.
contextBridge.exposeInMainWorld("__ottercode", {
  invoke: (channel: string, payload: unknown) =>
    ipcRenderer.invoke(channel, payload),
});

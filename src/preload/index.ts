import { contextBridge, ipcRenderer } from "electron";

// The door. Two raw transports, mechanically exposed — no logic, no
// state. If an `if` shows up here, the contract is wrong; typing lives
// in shared/ipc/client.ts, which wraps these into the typed client.
contextBridge.exposeInMainWorld("__ottercode", {
  invoke: (channel: string, payload: unknown) =>
    ipcRenderer.invoke(channel, payload),
  subscribe: (channel: string, listener: (payload: unknown) => void) => {
    const onMessage = (_event: unknown, payload: unknown): void =>
      listener(payload);
    ipcRenderer.on(channel, onMessage);
    return () => {
      ipcRenderer.removeListener(channel, onMessage);
    };
  },
});

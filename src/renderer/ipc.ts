import {
  createClient,
  type Invoke,
  type OttercodeClient,
  type Subscribe,
} from "../shared/ipc/client";

declare global {
  interface Window {
    __ottercode: { invoke: Invoke; subscribe: Subscribe };
  }
}

/**
 * The single typed client instance for the renderer. The renderer owns
 * the fact that transport comes from `window` (preload's bridge) —
 * shared/ stays DOM-free.
 */
export const client: OttercodeClient = createClient({
  invoke: window.__ottercode.invoke,
  subscribe: window.__ottercode.subscribe,
});

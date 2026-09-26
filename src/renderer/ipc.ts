import {
  createClient,
  type Invoke,
  type OttercodeClient,
} from "../shared/ipc/client";

declare global {
  interface Window {
    __ottercode: { invoke: Invoke };
  }
}

/**
 * The single typed client instance for the renderer. The renderer owns
 * the fact that transport comes from `window` (preload's bridge) —
 * shared/ stays DOM-free.
 */
export const client: OttercodeClient = createClient(window.__ottercode.invoke);

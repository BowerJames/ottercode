import { client } from "../../ipc";
import { createEditorStore } from "./store";

/**
 * The feature's composition root: the one place the real client
 * singleton is joined to the store factory. Components import this;
 * store.ts stays pure and testable.
 */
export const useEditor = createEditorStore(client.fs);

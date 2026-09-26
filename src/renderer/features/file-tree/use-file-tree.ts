import { client } from "../../ipc";
import { createFileTreeStore } from "./store";

/**
 * The feature's composition root: the one place the real client
 * singleton is joined to the store factory. Components import this;
 * store.ts stays pure and testable.
 */
export const useFileTree = createFileTreeStore(client.fs);

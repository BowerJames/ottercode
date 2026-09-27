import { client } from "../../ipc";
import { createGitStore } from "./store";

/**
 * The feature's composition root: the one place the real client
 * singleton is joined to the store factory. Store.ts stays pure and
 * testable.
 */
export const useGit = createGitStore(client.git);

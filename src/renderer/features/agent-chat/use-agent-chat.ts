import { client } from "../../ipc";
import { createAgentChatStore } from "./store";

/**
 * The feature's composition root: the one place the real client
 * singleton is joined to the store factory. Importing this module
 * starts the event subscription — the singleton is app-lifetime.
 */
export const useAgentChat = createAgentChatStore(client.agent);

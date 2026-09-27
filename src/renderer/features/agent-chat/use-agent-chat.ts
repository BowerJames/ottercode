import { client } from "../../ipc";
import { collectRun } from "../terminal/collect-run";
import { useTerminal } from "../terminal/use-terminal";
import { createAgentChatStore } from "./store";

/**
 * The feature's composition root: the one place the real client
 * singleton is joined to the store factory. Importing this module
 * starts the event subscription — the singleton is app-lifetime.
 */
export const useAgentChat = createAgentChatStore(client.agent);

// Terminal tracking: the one place the two features meet. Completed
// terminal runs (seen once, in order) become tracked records — the
// agent-chat store's own gate decides whether each one is recorded.
// Views are never re-examined: a run completes exactly once, and the
// monotonic id makes the "already seen" check a single comparison.
let lastSeenRunId = 0;
useTerminal.subscribe((state, prev) => {
  if (state.runs === prev.runs) return;
  const chat = useAgentChat.getState();
  for (const runView of state.runs) {
    if (runView.id > lastSeenRunId && runView.exitCode !== undefined) {
      lastSeenRunId = runView.id;
      chat.recordRun(collectRun(runView));
    }
  }
});

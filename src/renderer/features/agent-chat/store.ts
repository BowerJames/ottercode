import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { OttercodeClient } from "../../../shared/ipc/client";

/** The slice of the client the agent chat depends on. */
export type AgentChatClient = Pick<
  OttercodeClient["agent"],
  "submit" | "abort" | "onEvent" | "provider" | "setProvider"
>;

/** One rendered row of the transcript. Assistant entries accumulate
 * deltas append-only (contract clause); the rail renders entry.text.
 * Ids are stable React keys — entries append, never reorder. */
export type TranscriptEntry =
  | { id: number; kind: "user"; message: string }
  | { id: number; kind: "assistant"; text: string }
  | { id: number; kind: "tool"; name: string }
  | { id: number; kind: "error"; message: string };

export type AgentChatState = {
  entries: TranscriptEntry[];
  status: "idle" | "working";
  /** The active provider (bootstrap default; the dropdown's value). */
  provider: string;
  /** The picker's options, from the service registry. */
  available: string[];
  /** Last failed switch; null otherwise. The dropdown reverts. */
  switchError: string | null;
  /** Appends the user entry and submits the turn. Ignored while a turn
   * is working. Settles only after the store reflects the outcome. */
  send(message: string): Promise<void>;
  abort(): void;
  /** Swaps the agent provider: new session, cleared transcript.
   * Failure keeps everything — the old session keeps running. */
  switchProvider(name: string): Promise<void>;
  /** Bootstraps provider + options from the service. */
  loadProviderInfo(): Promise<void>;
};

export type UseAgentChatStore = UseBoundStore<StoreApi<AgentChatState>>;

/**
 * Builds the agent-chat store over an injected client slice and
 * subscribes to the event stream immediately (no event can be missed).
 * The subscription lives for the store's lifetime — the singleton is
 * app-lifetime, so there is nothing to unsubscribe in v1.
 */
export function createAgentChatStore(
  agent: AgentChatClient,
): UseAgentChatStore {
  let nextId = 0;
  const id = (): number => ++nextId;

  return create<AgentChatState>()((set, get) => {
    agent.onEvent((event) => {
      set((s) => {
        switch (event.type) {
          case "turn-start":
            return { status: "working" };
          case "assistant-delta": {
            // Append-only accumulation (contract clause).
            const last = s.entries.at(-1);
            if (last !== undefined && last.kind === "assistant") {
              return {
                entries: [
                  ...s.entries.slice(0, -1),
                  {
                    id: last.id,
                    kind: "assistant",
                    text: last.text + event.text,
                  },
                ],
              };
            }
            return {
              entries: [
                ...s.entries,
                { id: id(), kind: "assistant", text: event.text },
              ],
            };
          }
          case "tool-start":
            return {
              entries: [
                ...s.entries,
                { id: id(), kind: "tool", name: event.name },
              ],
            };
          case "tool-end":
            return s; // v1: tool entries don't track completion
          case "turn-end":
            return { status: "idle" };
          case "error":
            return {
              status: "idle",
              entries: [
                ...s.entries,
                { id: id(), kind: "error", message: event.message },
              ],
            };
        }
      });
    });

    return {
      entries: [],
      status: "idle",
      provider: "",
      available: [],
      switchError: null,

      async send(message) {
        if (get().status === "working") return;
        const result = await agent.submit(message);
        if (result.ok) {
          set((s) => ({
            entries: [...s.entries, { id: id(), kind: "user", message }],
          }));
        }
      },

      abort() {
        agent.abort();
      },

      async switchProvider(name) {
        const result = await agent.setProvider(name);
        if (result.ok) {
          // New conversation: the reset comes from this response, not
          // from events (the cancelled turn emits no terminator).
          set({
            provider: name,
            entries: [],
            status: "idle",
            switchError: null,
          });
        } else {
          set({ switchError: `${name} unavailable` });
        }
      },

      async loadProviderInfo() {
        const info = await agent.provider();
        set({ provider: info.provider, available: info.available });
      },
    };
  });
}

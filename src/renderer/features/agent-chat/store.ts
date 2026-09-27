import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { AgentFileEdit, AgentModelInfo } from "../../../shared/ipc/agent";
import type { OttercodeClient } from "../../../shared/ipc/client";

/** The slice of the client the agent chat depends on. */
export type AgentChatClient = Pick<
  OttercodeClient["agent"],
  "submit" | "abort" | "onEvent" | "provider" | "setProvider" | "setModel"
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
  /** The model actually in effect (adapter-resolved at creation). */
  model: string;
  /** The model picker's options (adapter-enumerated, filterable). */
  models: AgentModelInfo[];
  /** Last failed switch; null otherwise. The dropdown reverts. */
  switchError: string | null;
  /** Whether the next send attaches the editor's dirty copies. The
   * rail's footer renders and controls it; the composer consumes it
   * at gather time. Presentation state — default on, not persisted. */
  includeEdits: boolean;
  /** Appends the user entry (the raw message — the rail shows what
   * the user typed, never the composed prompt) and submits the turn
   * with the caller-gathered edits. Ignored while a turn is working.
   * Settles only after the store reflects the outcome. */
  send(message: string, edits?: AgentFileEdit[]): Promise<void>;
  abort(): void;
  /** Swaps the agent provider: new session, cleared transcript.
   * Failure keeps everything — the old session keeps running. */
  switchProvider(name: string): Promise<void>;
  /** Changes the model: new session, cleared transcript (uniform with
   * provider swaps). Failure keeps everything. */
  switchModel(model: string): Promise<void>;
  /** Bootstraps provider + model info from the service. */
  loadProviderInfo(): Promise<void>;
  /** Sets the include-edits gate. Driven by the rail footer's
   * checkbox — takes the input's checked state, not a blind toggle. */
  setIncludeEdits(next: boolean): void;
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
      model: "",
      models: [],
      switchError: null,
      includeEdits: true,

      async send(message, edits) {
        if (get().status === "working") return;
        const result = await agent.submit({ message, edits: edits ?? [] });
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
          await get().loadProviderInfo(); // refresh model + options
        } else {
          set({ switchError: `${name} unavailable` });
        }
      },

      async switchModel(model) {
        const result = await agent.setModel(model);
        if (result.ok) {
          set({
            model,
            entries: [],
            status: "idle",
            switchError: null,
          });
        } else {
          set({ switchError: `${model} unavailable` });
        }
      },

      async loadProviderInfo() {
        const info = await agent.provider();
        set({
          provider: info.provider,
          available: info.available,
          model: info.model,
          models: info.models,
        });
      },

      setIncludeEdits(next) {
        set({ includeEdits: next });
      },
    };
  });
}

import { create, type StoreApi, type UseBoundStore } from "zustand";
import type {
  AgentFileEdit,
  AgentModelInfo,
  AgentSelection,
  AgentTerminalRun,
  AgentThinkingInfo,
  AgentThinkingLevel,
} from "../../../shared/ipc/agent";
import type { OttercodeClient } from "../../../shared/ipc/client";

/** The slice of the client the agent chat depends on. */
export type AgentChatClient = Pick<
  OttercodeClient["agent"],
  | "submit"
  | "submitSelection"
  | "abort"
  | "onEvent"
  | "provider"
  | "setProvider"
  | "setModel"
  | "setThinking"
  | "newChat"
>;

/** One rendered row of the transcript. Assistant entries accumulate
 * deltas append-only (contract clause); the rail renders entry.text.
 * Ids are stable React keys — entries append, never reorder. */
export type TranscriptEntry =
  | {
      id: number;
      kind: "user";
      message: string;
      /** Set on selection turns: the file the selection came from —
       * the rail renders it as a provenance marker. */
      selectionPath?: string;
    }
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
  /** The thinking picker's state — level plus the active model's
   * offered levels. Null hides the picker (no meaningful choice).
   * Unlike the swaps below, changing the level keeps the session —
   * and therefore the transcript — standing. */
  thinking: AgentThinkingInfo | null;
  /** Last failed switch; null otherwise. The dropdown reverts. */
  switchError: string | null;
  /** Whether the next send attaches the editor's dirty copies. The
   * rail's footer renders and controls it; the composer consumes it
   * at gather time. Presentation state — default on, not persisted. */
  includeEdits: boolean;
  /** Whether terminal runs are RECORDED while on — the gate is read
   * at run completion, so only commands that finish while checked
   * ride along (the inverse of pi's `!!`: off IS the exclusion).
   * Presentation state — default off, not persisted. */
  trackTerminal: boolean;
  /** Runs recorded while the gate was on, waiting for the next send.
   * Drained by an accepted send — runs are events, told once (unlike
   * edits, which re-send as current state). */
  trackedRuns: AgentTerminalRun[];
  /** Appends the user entry (the raw message — the rail shows what
   * the user typed, never the composed prompt) and submits the turn
   * with the caller-gathered edits and terminal runs. An empty
   * message is a legal turn — the attachments carry it (the composer
   * gates that; this store adds no emptiness guard of its own).
   * Ignored while a turn is working. Settles only after the store
   * reflects the outcome; an accepted send drains the tracked-run
   * buffer. */
  send(
    message: string,
    edits?: AgentFileEdit[],
    terminalRuns?: AgentTerminalRun[],
  ): Promise<void>;
  /** Submits a focused turn: the message plus ONE editor selection,
   * and nothing else — no edits are gathered (the include-edits gate
   * does not apply) and no tracked runs attach or DRAIN (queued runs
   * stay queued for the next composer send). Appends the user entry
   * with the selection's path as its provenance marker. Ignored while
   * a turn is working, same guard as send. Settles only after the
   * store reflects the outcome. */
  sendSelection(message: string, selection: AgentSelection): Promise<void>;
  abort(): void;
  /** Swaps the agent provider: new session, cleared transcript.
   * Failure keeps everything — the old session keeps running. */
  switchProvider(name: string): Promise<void>;
  /** Changes the model: new session, cleared transcript (uniform with
   * provider swaps). Failure keeps everything. */
  switchModel(model: string): Promise<void>;
  /** Changes the thinking level on the LIVE session — the transcript
   * and any in-flight turn stand. Failure keeps the level and records
   * the error (the picker reverts). */
  switchThinking(level: AgentThinkingLevel): Promise<void>;
  /** Starts a new chat: fresh session, cleared transcript, same
   * provider and model (pickers keep their values — no refetch).
   * Failure keeps everything, mid-turn included. */
  newChat(): Promise<void>;
  /** Bootstraps provider + model info from the service. */
  loadProviderInfo(): Promise<void>;
  /** Records one completed terminal run — appended only while the
   * track-terminal gate is on (read at record time). Called by the
   * composition-root wiring, never by components. */
  recordRun(run: AgentTerminalRun): void;
  /** Empties the tracked buffer without touching the gate — the
   * footer's × escape hatch before an accidental send. */
  clearTracked(): void;
  /** Sets the include-edits gate. Driven by the rail footer's
   * checkbox — takes the input's checked state, not a blind toggle. */
  setIncludeEdits(next: boolean): void;
  /** Sets the track-terminal gate. Same driver, same contract. */
  setTrackTerminal(next: boolean): void;
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
      thinking: null,
      switchError: null,
      includeEdits: true,
      trackTerminal: false,
      trackedRuns: [],

      async send(message, edits, terminalRuns) {
        if (get().status === "working") return;
        const runs = terminalRuns ?? [];
        const result = await agent.submit({
          message,
          edits: edits ?? [],
          terminalRuns: runs,
        });
        if (result.ok) {
          set((s) => ({
            entries: [...s.entries, { id: id(), kind: "user", message }],
            // Runs are events, told once: an accepted send drains the
            // buffer. A refusal keeps them queued for the next send.
            trackedRuns: [],
          }));
        }
      },

      async sendSelection(message, selection) {
        if (get().status === "working") return;
        const result = await agent.submitSelection({ message, selection });
        if (result.ok) {
          // No trackedRuns touch here — deliberate: a focused turn
          // neither attaches nor drains the queue (see the doc above).
          set((s) => ({
            entries: [
              ...s.entries,
              {
                id: id(),
                kind: "user",
                message,
                selectionPath: selection.path,
              },
            ],
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
          // The new model may offer different thinking levels (or none) —
          // refresh so the picker never shows stale choices.
          await get().loadProviderInfo();
        } else {
          set({ switchError: `${model} unavailable` });
        }
      },

      async switchThinking(level) {
        const result = await agent.setThinking(level);
        if (result.ok) {
          set((s) =>
            s.thinking === null
              ? s
              : { thinking: { ...s.thinking, level }, switchError: null },
          );
        } else {
          set({ switchError: `thinking level ${level} unavailable` });
        }
      },

      async newChat() {
        const result = await agent.newChat();
        if (result.ok) {
          // Reset comes from this response, not events (the cancelled
          // turn emits no terminator) — same clause as the swaps.
          // Provider/model are untouched: the service preserved them.
          set({ entries: [], status: "idle", switchError: null });
        } else {
          set({ switchError: "couldn't start a new chat" });
        }
      },

      async loadProviderInfo() {
        const info = await agent.provider();
        set({
          provider: info.provider,
          available: info.available,
          model: info.model,
          models: info.models,
          thinking: info.thinking,
        });
      },

      setIncludeEdits(next) {
        set({ includeEdits: next });
      },

      setTrackTerminal(next) {
        set({ trackTerminal: next });
      },

      recordRun(run) {
        if (!get().trackTerminal) return; // the gate is read HERE —
        // at completion time — which is what makes "commands run
        // while checked" true regardless of later flips.
        set((s) => ({ trackedRuns: [...s.trackedRuns, run] }));
      },

      clearTracked() {
        set({ trackedRuns: [] });
      },
    };
  });
}

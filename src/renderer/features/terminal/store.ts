import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { OttercodeClient } from "../../../shared/ipc/client";
import type { TerminalEvent } from "../../../shared/ipc/terminal";

/** The slice of the client the terminal depends on. */
export type TerminalClient = Pick<
  OttercodeClient["terminal"],
  "run" | "abort" | "onEvent"
>;

/** One rendered run. `output` is the sanitized combined stream,
 * append-only while live. */
export type TerminalRunView = {
  /** Stable React key; monotonic, never reused. */
  id: number;
  command: string;
  output: string;
  /** Undefined while the run is live; null = died by signal. */
  exitCode: number | null | undefined;
  cancelled: boolean;
};

export type TerminalState = {
  /**
   * The dock's open state. Deliberately sticky: nothing but toggle
   * flips it — runs finishing (or failing) never close the panel.
   * App-lifetime presentation state, not persisted.
   */
  open: boolean;
  /** True between a run's started and exit events. */
  running: boolean;
  /**
   * The panel's history: append-only, oldest first, trimmed from the
   * front at MAX_RUNS (and each run's output capped) so a persistent
   * dock can't grow without bound. Presentation policy — workspace-
   * scoped, so nothing conversation-scoped (agent turns, new chat)
   * ever clears it.
   */
  runs: TerminalRunView[];
  /** Submits a command; the run's views arrive as events — a busy
   * refusal starts nothing. Settles after the response. */
  run(command: string): Promise<void>;
  /** Kills the running command (no-op when idle). */
  abort(): void;
  /** Flips the dock's open state — the persistence rule. */
  toggle(): void;
};

export type UseTerminalStore = UseBoundStore<StoreApi<TerminalState>>;

/** Policy: runs kept in the history before trimming the oldest. */
const MAX_RUNS = 100;

/** Policy: characters kept per run's view output (rolling tail). */
const MAX_OUTPUT_CHARS = 1_000_000;

/**
 * Builds the terminal store over an injected client slice and
 * subscribes to the event stream immediately (no event can be
 * missed). Views are built ONLY from pushed events — run() never
 * appends locally, so the stream stays the single source. The
 * subscription lives for the store's lifetime — the singleton is
 * app-lifetime.
 */
export function createTerminalStore(
  terminal: TerminalClient,
): UseTerminalStore {
  let nextId = 0;

  return create<TerminalState>()((set) => {
    terminal.onEvent((event: TerminalEvent) => {
      set((s) => {
        switch (event.type) {
          case "started":
            return {
              running: true,
              runs: [
                ...s.runs,
                {
                  id: ++nextId,
                  command: event.command,
                  output: "",
                  exitCode: undefined,
                  cancelled: false,
                },
              ].slice(-MAX_RUNS),
            };
          case "output": {
            const last = s.runs.at(-1);
            // Chunks before any start (or after a trimmed history)
            // have nowhere to land — dropped, never misplaced.
            if (last === undefined || last.exitCode !== undefined) return s;
            return {
              runs: [
                ...s.runs.slice(0, -1),
                {
                  ...last,
                  output: (last.output + event.chunk).slice(-MAX_OUTPUT_CHARS),
                },
              ],
            };
          }
          case "exit": {
            const last = s.runs.at(-1);
            if (last === undefined || last.exitCode !== undefined) return s;
            return {
              running: false,
              runs: [
                ...s.runs.slice(0, -1),
                {
                  ...last,
                  exitCode: event.exitCode,
                  cancelled: event.cancelled,
                },
              ],
            };
          }
        }
      });
    });

    return {
      open: false,
      running: false,
      runs: [],

      async run(command) {
        await terminal.run(command); // busy refusals start nothing here
      },

      abort() {
        terminal.abort();
      },

      toggle() {
        set((s) => ({ open: !s.open }));
      },
    };
  });
}

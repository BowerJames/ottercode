import type {
  AgentEvent,
  AgentProviderInfo,
  AgentReconfigResult,
  AgentSetThinkingResult,
  AgentSubmitRequest,
  AgentSubmitResult,
  AgentThinkingLevel,
  SetModelRequest,
  SetProviderRequest,
  SetThinkingLevelRequest,
} from "./agent.js";
import {
  AGENT_ABORT_CHANNEL,
  AGENT_EVENTS_CHANNEL,
  AGENT_NEW_CHAT_CHANNEL,
  AGENT_PROVIDER_CHANNEL,
  AGENT_SET_MODEL_CHANNEL,
  AGENT_SET_PROVIDER_CHANNEL,
  AGENT_SET_THINKING_CHANNEL,
  AGENT_SUBMIT_CHANNEL,
  FS_LIST_CHILDREN_CHANNEL,
  FS_READ_FILE_CHANNEL,
  FS_ROOT_CHANNEL,
  GIT_STATUS_CHANNEL,
  TERMINAL_ABORT_CHANNEL,
  TERMINAL_EVENTS_CHANNEL,
  TERMINAL_RUN_CHANNEL,
} from "./channels.js";
import type {
  ListChildrenRequest,
  ListChildrenResult,
  ReadFileRequest,
  ReadFileResult,
  RootResult,
} from "./fs.js";
import type { GitStatusResult } from "./git.js";
import type {
  TerminalEvent,
  TerminalRunRequest,
  TerminalRunResult,
} from "./terminal.js";

/**
 * The transport seam. The real adapter is preload's ipcRenderer bridge
 * (invoke + push events); the test adapter is an in-memory fake.
 * Channel-name strings and payload assembly live here and nowhere else
 * on the renderer side — both sides of the wire share the same
 * constants and types, so contract wiring drift is a compile error.
 */
export type Invoke = (channel: string, request: unknown) => Promise<unknown>;

/** Subscribe to a push channel; returns the unsubscribe function. */
export type Subscribe = (
  channel: string,
  listener: (payload: unknown) => void,
) => () => void;

export type ClientTransport = {
  invoke: Invoke;
  subscribe: Subscribe;
};

/** The only door the renderer uses to reach the main process. */
export interface OttercodeClient {
  fs: {
    root(): Promise<RootResult>;
    listChildren(path: string): Promise<ListChildrenResult>;
    readFile(path: string): Promise<ReadFileResult>;
  };
  git: {
    status(): Promise<GitStatusResult>;
  };
  terminal: {
    /** Run one command. Fire-and-forget — outcome arrives on events. */
    run(command: string): Promise<TerminalRunResult>;
    /** Kill the running command (no-op when idle). */
    abort(): Promise<void>;
    /** Subscribe to the terminal event stream. Returns unsubscribe. */
    onEvent(handler: (event: TerminalEvent) => void): () => void;
  };
  agent: {
    submit(request: AgentSubmitRequest): Promise<AgentSubmitResult>;
    abort(): Promise<void>;
    /** Subscribe to the agent event stream. Returns unsubscribe. */
    onEvent(handler: (event: AgentEvent) => void): () => void;
    provider(): Promise<AgentProviderInfo>;
    setProvider(provider: string): Promise<AgentReconfigResult>;
    setModel(model: string): Promise<AgentReconfigResult>;
    /** Set the thinking level live — the session is NOT replaced. */
    setThinking(level: AgentThinkingLevel): Promise<AgentSetThinkingResult>;
    /** Replace the session with a fresh one (same provider + model).
     * The response — not events — is the reset signal for consumers. */
    newChat(): Promise<AgentReconfigResult>;
  };
}

export function createClient(transport: ClientTransport): OttercodeClient {
  const { invoke, subscribe } = transport;
  return {
    fs: {
      root() {
        // The cast is the one crossing of Electron's untyped wire: safe
        // because the glue handler is compiled against the same types.
        return invoke(FS_ROOT_CHANNEL, {}) as Promise<RootResult>;
      },
      listChildren(path: string) {
        // Typed construction: a malformed request is a compile error.
        const request: ListChildrenRequest = { path };
        return invoke(
          FS_LIST_CHILDREN_CHANNEL,
          request,
        ) as Promise<ListChildrenResult>;
      },
      readFile(path: string) {
        const request: ReadFileRequest = { path };
        return invoke(FS_READ_FILE_CHANNEL, request) as Promise<ReadFileResult>;
      },
    },
    git: {
      status() {
        return invoke(GIT_STATUS_CHANNEL, {}) as Promise<GitStatusResult>;
      },
    },
    terminal: {
      run(command: string) {
        const request: TerminalRunRequest = { command };
        return invoke(
          TERMINAL_RUN_CHANNEL,
          request,
        ) as Promise<TerminalRunResult>;
      },
      abort() {
        return invoke(TERMINAL_ABORT_CHANNEL, {}) as Promise<void>;
      },
      onEvent(handler) {
        return subscribe(TERMINAL_EVENTS_CHANNEL, (payload) =>
          handler(payload as TerminalEvent),
        );
      },
    },
    agent: {
      submit(request: AgentSubmitRequest) {
        return invoke(
          AGENT_SUBMIT_CHANNEL,
          request,
        ) as Promise<AgentSubmitResult>;
      },
      abort() {
        return invoke(AGENT_ABORT_CHANNEL, {}) as Promise<void>;
      },
      onEvent(handler) {
        return subscribe(AGENT_EVENTS_CHANNEL, (payload) =>
          handler(payload as AgentEvent),
        );
      },
      provider() {
        return invoke(AGENT_PROVIDER_CHANNEL, {}) as Promise<AgentProviderInfo>;
      },
      setProvider(provider: string) {
        const request: SetProviderRequest = { provider };
        return invoke(
          AGENT_SET_PROVIDER_CHANNEL,
          request,
        ) as Promise<AgentReconfigResult>;
      },
      setModel(model: string) {
        const request: SetModelRequest = { model };
        return invoke(
          AGENT_SET_MODEL_CHANNEL,
          request,
        ) as Promise<AgentReconfigResult>;
      },
      setThinking(level: AgentThinkingLevel) {
        const request: SetThinkingLevelRequest = { level };
        return invoke(
          AGENT_SET_THINKING_CHANNEL,
          request,
        ) as Promise<AgentSetThinkingResult>;
      },
      newChat() {
        return invoke(
          AGENT_NEW_CHAT_CHANNEL,
          {},
        ) as Promise<AgentReconfigResult>;
      },
    },
  };
}

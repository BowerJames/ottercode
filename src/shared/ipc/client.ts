import type {
  AgentEvent,
  AgentSubmitRequest,
  AgentSubmitResult,
} from "./agent.js";
import {
  AGENT_ABORT_CHANNEL,
  AGENT_EVENTS_CHANNEL,
  AGENT_SUBMIT_CHANNEL,
  FS_LIST_CHILDREN_CHANNEL,
  FS_READ_FILE_CHANNEL,
  FS_ROOT_CHANNEL,
} from "./channels.js";
import type {
  ListChildrenRequest,
  ListChildrenResult,
  ReadFileRequest,
  ReadFileResult,
  RootResult,
} from "./fs.js";

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
  agent: {
    submit(message: string): Promise<AgentSubmitResult>;
    abort(): Promise<void>;
    /** Subscribe to the agent event stream. Returns unsubscribe. */
    onEvent(handler: (event: AgentEvent) => void): () => void;
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
    agent: {
      submit(message: string) {
        const request: AgentSubmitRequest = { message };
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
    },
  };
}
